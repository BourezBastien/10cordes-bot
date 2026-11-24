import { Logger } from '@spraxium/logger';
import type { AuditService } from '../audit/audit.service';
import { accessContextFromNames } from '../../core/security/access-policy';
import { massMentionPolicy } from '../../core/security/mass-mention.policy';
import { notice } from '../../shared/ui';
import { splitDiscordMessage } from '../../shared/utils/message-split';
import type { ConversationContext } from './conversation-context';
import { LlmFormatLeakError, ProviderAuthError, ProviderUnavailableError, QUOTA_EXHAUSTED_MESSAGE, QuotaExhaustedError } from './llm.errors';
import type { ReplyRunOutcome } from './reply-runner';
import type { ResponseCacheService } from './response-cache.service';

const log = new Logger('Assistant');

/** Présentation structurée demandée par le modèle. */
const PANEL_PREFIX_RE = /^\[PANEL\]\s*/i;

export interface ReplyDeliveryDeps {
  readonly audit: AuditService;
  readonly responseCache: ResponseCacheService;
}

/**
 * Livraison dans le salon, et rien d'autre : réponse en cache, notice
 * d'erreur (aucune erreur ne reste silencieuse), silence demandé, morceaux
 * adressés au message d'origine, cache des coûts. C'est le SEUL endroit qui
 * écrit la réponse d'une demande : rien n'est publié avant elle.
 */
export class ReplyDelivery {
  constructor(private readonly deps: ReplyDeliveryDeps) {}

  /**
   * Réponse en cache (question identique posée récemment dans le serveur) :
   * renvoyée sans appel LLM, jamais pour une demande d'action. Rend vrai si
   * une réponse a été livrée.
   */
  async deliverCached(conversation: ConversationContext): Promise<boolean> {
    const { channel, guild, request, requestId, session } = conversation;
    if (session.silent) return false;
    const cachedReply = this.deps.responseCache.get(guild.id, request.content);
    if (!cachedReply) return false;

    log.info(`[FLOW] cache HIT pour ${request.authorName} [${requestId}]`);
    await this.sendAddressed(channel, request.messageId, [cachedReply]);
    this.deps.audit.record({
      guildId: guild.id,
      source: 'agent',
      action: 'llm.cache.hit',
      actorId: request.userId,
      metadata: {},
    });
    return true;
  }

  /** Livre le résultat de la boucle : tout part dans le salon, en texte simple (décision produit du 17/11). */
  async deliver(conversation: ConversationContext, run: ReplyRunOutcome): Promise<void> {
    const { channel, request, session } = conversation;
    let finalText = run.finalText;

    if (finalText === null) {
      // Aucune erreur ne reste silencieuse : notice en salon + audit avec
      // requestId. Les erreurs génériques ne remontent plus au worker.
      if (run.error) {
        await this.reportFailure(conversation, run.error);
        return;
      }
      // Tools exécutés sans texte final : les résultats sont VISIBLES dans le
      // salon (salons créés, fichiers, panels), aucun remplissage demandé.
      finalText = run.executed.length > 0 ? '' : 'Fait.';
    }

    // Comptabilité IA : un enregistrement par demande (somme des itérations, nombre de tours).
    if (run.usage.promptTokens + run.usage.completionTokens > 0) {
      this.deps.audit.record({
        guildId: conversation.guild.id,
        source: 'agent',
        action: 'llm.usage',
        actorId: request.userId,
        metadata: {
          requestId: conversation.requestId,
          cause: 'reply',
          promptTokens: run.usage.promptTokens,
          completionTokens: run.usage.completionTokens,
          turns: run.turns,
        },
      });
    }

    if (PANEL_PREFIX_RE.test(finalText)) {
      finalText = finalText.replace(PANEL_PREFIX_RE, '').trim();
    }

    // Silence demandé : les actions sont exécutées, aucun message n'est envoyé.
    if (session.silent) {
      this.deps.audit.record({
        guildId: conversation.guild.id,
        source: 'agent',
        action: 'assistant.reply',
        actorId: request.userId,
        metadata: { requestId: conversation.requestId, locale: conversation.locale, silent: true, tools: run.executed.join(',') },
      });
      return;
    }

    // Mentions de masse : réservées au propriétaire du serveur et aux administrateurs ; pour les
    // autres, @everyone et @here s'affichent en texte, sans ping (quelle que soit la casse).
    const finalDelivery = massMentionPolicy.guard(finalText, accessContextFromNames(conversation.guild, request.userId, conversation.permissions));

    // Chaque morceau tient dans un message, et la coupure ne se voit pas (paragraphe, ligne, mot).
    const chunks = splitDiscordMessage(finalDelivery);
    await this.sendAddressed(channel, request.messageId, chunks);
    // Le cache coûts ne s'applique qu'aux réponses conversationnelles pures sans tools.
    if (run.executed.length === 0 && chunks.length === 1 && chunks[0].trim()) {
      this.deps.responseCache.put(conversation.guild.id, request.content, chunks[0]);
    }
    this.recordReply(conversation, run.executed.length);
  }

  /**
   * Envoie les morceaux d'une réponse ADRESSÉE : le premier répond au message
   * d'origine (reply messageReference, failIfNotExists pour survivre à sa
   * suppression) ; fallback channel.send nu si le reply échoue (message
   * source parti, permissions). Décision v3 : le bot ne « parle dans le vide » plus.
   */
  private async sendAddressed(channel: ConversationContext['channel'], messageId: string, chunks: readonly string[]): Promise<void> {
    let replied = false;
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      if (!replied) {
        const sent = await channel
          .send({ content: chunk, reply: { messageReference: messageId, failIfNotExists: false } })
          .then(() => true)
          .catch(() => false);
        replied = sent;
        if (sent) continue;
      }
      await channel.send({ content: chunk }).catch(() => {});
    }
  }

  /** Notice en salon + audit typé pour une erreur de la boucle (référence visible). */
  private async reportFailure(conversation: ConversationContext, error: Error): Promise<void> {
    const { channel, guild, request, requestId } = conversation;
    const noticeFor = (message: string) => notice(`${message} [${requestId}]`, true);
    const recordError = (kind: string, extra: Record<string, unknown> = {}): void => {
      this.deps.audit.record({
        guildId: guild.id,
        source: 'agent',
        action: 'assistant.error',
        actorId: request.userId,
        metadata: { requestId, kind, ...extra },
      });
    };

    if (error instanceof QuotaExhaustedError) {
      recordError('quota');
      await channel.send(noticeFor(QUOTA_EXHAUSTED_MESSAGE)).catch(() => {});
      return;
    }
    if (error instanceof ProviderAuthError) {
      recordError('auth');
      await channel
        .send(noticeFor('Configuration IA invalide (clé rejetée). Contacte le staff : la clé API doit être corrigée.'))
        .catch(() => {});
      return;
    }
    if (error instanceof ProviderUnavailableError) {
      recordError('provider');
      await channel
        .send(noticeFor('Problème temporaire avec le fournisseur IA. Patiente quelques minutes et réessaie.'))
        .catch(() => {});
      return;
    }
    if (error instanceof LlmFormatLeakError) {
      recordError('format', { sample: error.sample.slice(0, 120) });
      await channel
        .send(noticeFor('Réponse IA malformée (le modèle a mêlé ses balises internes au texte). Réessaie, ou reformule ta demande.'))
        .catch(() => {});
      return;
    }
    recordError('generic', { error: error.message.slice(0, 300) });
    await channel.send(noticeFor(`Erreur IA : ${error.message.slice(0, 180)}`)).catch(() => {});
  }

  /** Audit de la réponse livrée : nombre de tools EXÉCUTÉS (pas la taille du catalogue). */
  private recordReply(conversation: ConversationContext, toolCount: number): void {
    const { guild, request, requestId, locale, permissions } = conversation;
    this.deps.audit.record({
      guildId: guild.id,
      source: 'agent',
      action: 'assistant.reply',
      actorId: request.userId,
      metadata: { requestId, locale, permissions: permissions.length, tools: toolCount, public: true },
    });
  }
}
