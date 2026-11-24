import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, type Guild, type Message, type TextChannel } from 'discord.js';
import { V2Service } from '@spraxium/components';
import { notice } from '../../shared/ui';
import { CacheStoreService } from '../../shared/cache/cache-store.service';
import { AppEnv } from '../../app.env';
import { getActionPlans } from '../action-plan/action-plan.runtime';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoryService } from '../memory/memory.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { GuildRulesService } from '../rules/guild-rules.service';
import { SkillPatternDetector } from '../agent/skill-pattern.detector';
import { IntegrationStatusPresenter } from '../integrations/presenters/integration-status.presenter';
import { guildAccessContext, guildAdminPolicy, guildManagerPolicy } from '../../core/security/access-policy';
import { AgentLoopService } from './agent-loop.service';
import { buildLastSnapshotTool } from './agent-history';
import { ConversationContextBuilder } from './conversation-context';
import { LlmService } from './llm.service';
import { IntroPresenter } from './presenters/intro.presenter';
import { AssistantQueue } from './assistant.queue';
import { AgentReplyRunner } from './reply-runner';
import { ReplyDelivery } from './reply-delivery';
import { ResponseCacheService } from './response-cache.service';
import { isSilenceRequested, ReplySession } from './reply-session';
import type { AgentRequest } from './queue/types';
import { IntroContainer } from './v2.containers';

const log = new Logger('Assistant');

const USER_COOLDOWN_MS = 4_000;
const TYPING_REFRESH_MS = 8_000;

/** Mention nue ou pure salutation : panneau d'identité immédiat, sans LLM. */
const BARE_GREETING_RE = /^(salut|bonjour|hello|yo|hey|coucou|slt|bjr|ping|hi)[\s!.,?]*$/i;

/**
 * Agent conversationnel : mention / salon dédié IA / réponse à un de ses
 * messages → demande mise en file (durable) → traitée par un worker avec
 * réponse publique dans le salon. Orchestration only : le contexte, la boucle
 * et la livraison sont confiés à des collaborateurs à responsabilité unique.
 */
@Injectable()
export class AssistantService {
  private readonly cooldowns = new Map<string, number>();

  // Presenters et collaborateurs PURS : champs de classe, PAS des paramètres
  // de constructeur. Une valeur par défaut dans la signature rend le token DI
  // « Object » et fait échouer le ModuleLoader (gotcha Spraxium récurrent).
  private readonly integrationPresenter = new IntegrationStatusPresenter();
  private readonly introPresenter = new IntroPresenter();
  private readonly contextBuilder: ConversationContextBuilder;
  private readonly runner: AgentReplyRunner;
  private readonly delivery: ReplyDelivery;

  constructor(
    private readonly llm: LlmService,
    private readonly loop: AgentLoopService,
    private readonly registry: ToolRegistryService,
    private readonly config: GuildConfigService,
    private readonly audit: AuditService,
    private readonly memory: MemoryService,
    private readonly queue: AssistantQueue,
    private readonly v2: V2Service,
    private readonly client: Client,
    private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly responseCache: ResponseCacheService,
    private readonly guildRules: GuildRulesService,
    private readonly patterns: SkillPatternDetector,
    private readonly cacheStore: CacheStoreService,
  ) {
    this.contextBuilder = new ConversationContextBuilder({
      client: this.client,
      registry: this.registry,
      audit: this.audit,
      memory: this.memory,
      prisma: this.prisma,
      guildRules: this.guildRules,
    });
    this.runner = new AgentReplyRunner({
      loop: this.loop,
      llm: this.llm,
      audit: this.audit,
      patterns: this.patterns,
      cacheStore: this.cacheStore,
    });
    this.delivery = new ReplyDelivery({ audit: this.audit, responseCache: this.responseCache });
    queue.setProcessor((request) => this.processAgentRequest(request));
    this.registry.register(buildLastSnapshotTool(this.prisma));
  }

  /** Salon dédié IA configuré pour un serveur (vide = aucun). */
  async dedicatedChannelId(guildId: string): Promise<string | null> {
    const config = await this.config.get(guildId).catch(() => null);
    return config?.assistant.channelId || null;
  }

  /** Point d'entrée du listener : gâte la demande puis la met en file. */
  async enqueueMessage(message: Message, repliesToBot: boolean): Promise<void> {
    void repliesToBot;
    await this.queue.enqueueMessage(message, repliesToBot);
  }

  /** Processeur de la queue : antispam, redirection, puis traitement. */
  async processAgentRequest(request: AgentRequest): Promise<void> {
    const guild = this.client.guilds.cache.get(request.guildId) ?? (await this.client.guilds.fetch(request.guildId).catch(() => null));
    if (!guild) return;
    const channelMaybe = await this.client.channels.fetch(request.channelId).catch(() => null);
    if (!channelMaybe || !channelMaybe.isTextBased() || channelMaybe.partial) return;
    const channel = channelMaybe as TextChannel;

    await this.coalesceWithNewerMessage(channel, request);

    const guildConfig = await this.config.get(guild.id);

    // Salon dédié configuré ailleurs → redirection polie.
    const assistantChannel = guildConfig.assistant.channelId;
    if (assistantChannel && request.channelId !== assistantChannel) {
      await channel
        .send(notice(`Je ne réponds que dans <#${assistantChannel}> (ou configure un autre salon via le bouton Panneau).`, true))
        .catch(() => {});
      return;
    }

    // Antispam par utilisateur (auto-supprimé).
    const cooldownKey = `${guild.id}:${request.userId}`;
    const last = this.cooldowns.get(cooldownKey);
    const now = Date.now();
    if (last !== undefined && now - last < USER_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((USER_COOLDOWN_MS - (now - last)) / 1_000);
      const cooldownReply = await channel
        .send(notice(`Antispam : attends encore ${waitSeconds}s avant ta prochaine demande.`, true))
        .catch(() => null);
      if (cooldownReply) {
        setTimeout(() => cooldownReply.delete().catch(() => {}), 6_000).unref?.();
      }
      return;
    }
    this.cooldowns.set(cooldownKey, now);
    // Traçabilité : chaque demande porte un ID propagé dans les audits,
    // les logs FLOW et les notices d'erreur.
    const requestId = `req-${Math.random().toString(36).slice(2, 10)}`;
    log.info(`[FLOW] demande acceptée de ${request.authorName} [${requestId}]`);

    try {
      await this.processRequest(channel, guild, request, requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Assistant failure [${requestId}] user=${request.userId}: ${message}`);
      await channel
        .send(notice(`Erreur interne [${requestId}] : ${message.slice(0, 120)}. Signale cette référence au staff si ça se répète.`, true))
        .catch(() => {});
      this.audit.record({
        guildId: guild.id,
        source: 'agent',
        action: 'assistant.error',
        actorId: request.userId,
        metadata: { requestId, error: message.slice(0, 300) },
      });
    }
  }

  /**
   * Coalescing : si l'auteur a renvoyé un message PLUS RÉCENT dans le même
   * salon pendant la mise en file, on traite le plus récent (l'ancien reste
   * dans le transcript), une seule réponse globale au lieu de deux à la suite.
   */
  private async coalesceWithNewerMessage(channel: TextChannel, request: AgentRequest): Promise<void> {
    try {
      const recent = await channel.messages.fetch({ limit: 5 }).catch(() => null);
      const newer = [...(recent?.values() ?? [])]
        .filter((m) => m.author.id === request.userId && !m.author.bot)
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];
      if (newer && newer.id !== request.messageId && newer.createdTimestamp > (request.createdAtMs ?? 0)) {
        log.info(`[FLOW] coalescing : demande plus récente du même auteur, traitement fusionné [${request.messageId} → ${newer.id}]`);
        request.content = newer.content;
        request.messageId = newer.id;
        request.createdAtMs = newer.createdTimestamp;
      }
    } catch {
      // Le coalescing est best-effort : en cas d'échec, on traite la demande d'origine.
    }
  }

  private async processRequest(
    channel: TextChannel,
    guild: Guild,
    request: AgentRequest,
    requestId: string,
  ): Promise<void> {
    // A4 : délégation au Presenter. Un SEUL message V2, le bouton « Connecter »
    // inclus quand le demandeur est owner ou Administrator (GuildAdminPolicy).
    if (!(await this.llm.isConfiguredFor(guild.id))) {
      const member = await guild.members.fetch(request.userId).catch(() => null);
      const canConfigure = guildAdminPolicy.isAuthorized(guildAccessContext(guild, request.userId, member));
      await channel
        .send(this.integrationPresenter.render({ label: 'Fournisseur IA', connected: false, canConfigure }))
        .catch(() => {});
      return;
    }

    const stripped = request.content.replace(/<@?\d+>/g, '').trim();
    if (stripped.length === 0 || BARE_GREETING_RE.test(stripped)) {
      const member = await guild.members.fetch(request.userId).catch(() => null);
      const staff = guildManagerPolicy.isAuthorized(guildAccessContext(guild, request.userId, member));
      const introData = this.introPresenter.introData({
        botName: this.client.user?.username ?? '10cordes',
        displayName: member?.displayName ?? request.authorName,
        staff,
        avatarUrl: this.client.user?.displayAvatarURL({ size: 128 }) ?? '',
      });
      const introPayload = await this.v2.buildReply(IntroContainer, introData);
      await channel
        .send({
          components: introPayload.components as never,
          flags: introPayload.flags as never,
        })
        .catch(() => {});
      this.audit.record({
        guildId: guild.id,
        source: 'agent',
        action: 'assistant.intro',
        actorId: request.userId,
        metadata: {},
      });
      return;
    }

    // Boucle LLM : contexte complet, tools, livraison.
    await this.withTypingIndicator(channel, () => this.converse(channel, guild, request, requestId));
  }

  /** Indicateur « écrit... » rafraîchi pendant tout le traitement. */
  private async withTypingIndicator<T>(channel: TextChannel, task: () => Promise<T>): Promise<T> {
    await channel.sendTyping().catch(() => {});
    const interval = setInterval(() => {
      void channel.sendTyping().catch(() => {});
    }, TYPING_REFRESH_MS);
    try {
      return await task();
    } finally {
      clearInterval(interval);
    }
  }

  private async converse(channel: TextChannel, guild: Guild, request: AgentRequest, requestId: string): Promise<void> {
    const session = new ReplySession(channel, request.messageId, isSilenceRequested(request.content));
    session.status.arm();
    let delivered = false;
    try {
      const conversation = await this.contextBuilder.build(channel, guild, request, requestId, session);
      if (await this.delivery.deliverCached(conversation)) {
        delivered = true;
        return;
      }
      const outcome = await this.runner.run(conversation);
      await this.delivery.deliver(conversation, outcome);
      delivered = true;
    } finally {
      // GARANTIE ANTI-BLOCAGE : quoi qu'il arrive (contexte, boucle ou
      // livraison en erreur), la ligne de statut disparaît et aucun brouillon
      // non finalisé ne reste dans le salon. Le bot ne reste jamais « en réflexion ».
      // Fin de demande : les actions destructives restées en attente forment UN plan d'approbation.
      await getActionPlans()
        ?.flush(guild.id, request.userId)
        .catch(() => null);
      await session.status.done().catch(() => {});
      if (!delivered) session.rejectStream();
    }
  }
}
