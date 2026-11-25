import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, type TextChannel } from 'discord.js';
import { AuditService } from '../audit/audit.service';
import { getActionPlans } from '../action-plan/action-plan.runtime';
import { MemoryService } from '../memory/memory.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { LlmService, type ChatMessage, type OpenAiTool } from './llm.service';
import { QUOTA_EXHAUSTED_MESSAGE } from './llm.errors';
import { fetchRecentActions } from './agent-history';
import { sanitizeTranscriptLine } from './reply-text';
import { buildSystemPrompt } from './system-prompt.builder';
import { pinnedToolGuidance, selectRelevantTools, toolToOpenAiTool } from './tool-selection';
import { detectRequestIntent } from './request-intent';
import { AgentLoopService } from './agent-loop.service';
import { getSkillTriggers } from '../agent/skill.service';
import { GuildRulesService } from '../rules/guild-rules.service';
import { fileLog } from '../logging/file-log.service';
import { type ToolRunContext } from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';
import { permissionsOf } from '../../core/security/permission-name';
import { describeError, stackExcerpt } from '../../shared/utils/error-stack';
import { GuildIntegrationService } from '../integrations/guild-integration.service';
import { imageEnginesLine } from '../providers/image-engines';
import { CapabilityRouterService } from '../providers/capability-router.service';
import { RequestProgressService } from './request-progress.service';
import { AgentDecisionJournal } from './agent-decision.journal';
import { outcomeOf } from './agent-decision.recorder';
import { ShutdownService } from '../health/shutdown.service';

const RATE_LIMIT_MS = 4_000;
const MAX_MESSAGE_LENGTH = 2_000;
const TRANSCRIPT_SIZE = 12;
/** Longueur gardée du résumé d'un outil, dans le résultat du chat. */
const TOOL_SUMMARY_MAX = 200;

interface WebChatResult {
  reply: string | null;
  silent: boolean;
  tools: Array<{ name: string; ok: boolean; summary: string }>;
}

/**
 * Le même agent que Discord, exposé au dashboard web : mêmes tools, mêmes
 * gates de permissions (celles du MEMBRE Discord correspondant à l'utilisateur
 * connecté), même mémoire. Boucle LLM partagée via AgentLoopService (avec
 * comptabilité llm.usage, alignée sur le canal Discord).
 */
@Injectable()
export class WebAgentService {
  private readonly log = new Logger('WebAgent');
  private readonly rateLimits = new Map<string, number>();

  constructor(
    private readonly llm: LlmService,
    private readonly registry: ToolRegistryService,
    private readonly guildRules: GuildRulesService,
    private readonly loop: AgentLoopService,
    private readonly memory: MemoryService,
    private readonly config: GuildConfigService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly client: Client,
    private readonly router: CapabilityRouterService,
    private readonly integrations: GuildIntegrationService,
    private readonly progress: RequestProgressService,
    private readonly decisions: AgentDecisionJournal,
    private readonly shutdown: ShutdownService,
  ) {}

  /**
   * Répond à une demande venue du dashboard. `requestId` est l'identifiant que
   * le panel a choisi pour suivre les étapes de SA demande pendant qu'elle
   * tourne (lecture par `agent/requests/:requestId`) ; sans lui, la demande
   * garde un identifiant interne et rien n'est suivi.
   *
   * Une conversation commencée est suivie : l'extinction l'attend, dans son
   * délai de grâce, au lieu de la couper.
   */
  async chat(guildId: string, discordUserId: string, message: string, clientRequestId?: string): Promise<WebChatResult> {
    return this.shutdown.track(this.converse(guildId, discordUserId, message, clientRequestId));
  }

  private async converse(guildId: string, discordUserId: string, message: string, clientRequestId?: string): Promise<WebChatResult> {
    const trimmed = message.trim();
    if (trimmed.length === 0) throw new Error('Message vide.');
    if (trimmed.length > MAX_MESSAGE_LENGTH) throw new Error('Message trop long (2000 caractères max).');
    const tracked = clientRequestId !== undefined;
    const requestId = clientRequestId ?? `web-${Math.random().toString(36).slice(2, 10)}`;
    if (tracked) this.progress.start(guildId, requestId);

    const key = `${guildId}:${discordUserId}`;
    const last = this.rateLimits.get(key);
    if (last !== undefined && Date.now() - last < RATE_LIMIT_MS) {
      throw new Error('Trop de demandes : attends quelques secondes.');
    }
    this.rateLimits.set(key, Date.now());

    const guild = this.client.guilds.cache.get(guildId) ?? (await this.client.guilds.fetch(guildId).catch(() => null));
    if (!guild) throw new Error('Serveur introuvable.');

    const member = await guild.members.fetch(discordUserId).catch(() => null);
    if (!member) throw new Error("Tu n'es pas membre de ce serveur Discord.");
    const permissions = permissionsOf(member);

    const guildConfig = await this.config.get(guildId).catch(() => null);
    const channelId = guildConfig?.assistant.channelId || null;
    const channel = channelId
      ? ((await this.client.channels.fetch(channelId).catch(() => null)) as TextChannel | null)
      : null;

    const locale = 'fr';
    // Journal des décisions : même enregistrement que sur Discord.
    const decision = this.decisions.begin({ guildId, requestId, source: 'web', actorId: discordUserId, channelId: channel?.id ?? null });
    const tools = await this.registry.listForGuild(guildId);
    // Même routing que Discord : noyau + pertinents, catalogue joignable via
    // search_tools (expansion dynamique dans AgentLoop).
    const relevant = selectRelevantTools(trimmed, tools);
    const byName = new Map<string, OpenAiTool>(tools.map((tool) => [tool.name, toolToOpenAiTool(tool)]));
    const openAiTools: OpenAiTool[] = relevant.map((tool) => byName.get(tool.name)!);
    const toolset = { active: openAiTools, byName };

    const [guildProfile, memberProfile, recentActions, skillTriggers, serverRules, corrections] = await Promise.all([
      this.memory.getGuildProfile(guildId).catch(() => null),
      this.memory.getMemberProfile(guildId, discordUserId).catch(() => null),
      fetchRecentActions(this.prisma, guildId, 12).catch(() => [] as string[]),
      getSkillTriggers(guildId)
        .then((skills) => skills.map((skill) => `${skill.id} | ${skill.trigger}`))
        .catch(() => [] as string[]),
      this.guildRules.describeForPrompt(guildId).catch(() => [] as string[]),
      this.memory.correctionLines(guildId, [discordUserId]).catch(() => null),
    ]);
    // Les corrections priment sur les fiches : l'agent ne doit plus dire un fait corrigé.
    const ownCorrections = corrections?.members.get(discordUserId) ?? [];
    const guildMemories = [
      ...(guildProfile ? [`Fiche serveur consolidée : ${guildProfile}`] : []),
      ...(corrections && corrections.guild.length > 0 ? [`Faits corrigés sur le serveur (ils priment sur sa fiche) :\n${corrections.guild.join('\n')}`] : []),
    ];
    const memberMemories = [
      ...(memberProfile ? [`Fiche du membre (consolidée) : ${memberProfile}`] : []),
      ...(ownCorrections.length > 0 ? [`Faits corrigés sur le demandeur (ils priment sur sa fiche) :\n${ownCorrections.join('\n')}`] : []),
    ];

    const transcript = channel
      ? await channel.messages
          .fetch({ limit: TRANSCRIPT_SIZE })
          .then((collection) =>
            [...collection.values()]
              .reverse()
              .map((msg) => `[${sanitizeTranscriptLine(msg.author.username)} (${msg.author.id})] : ${sanitizeTranscriptLine((msg.content || '(sans texte)').slice(0, 200))}`)
              .join('\n'),
          )
          .catch(() => '')
      : '';

    const contextBlock = [
      transcript ? `Historique récent du salon Discord #${channel?.name ?? 'ia'} :\n${transcript}` : '',
      `Serveur : ${guild.name} (ID ${guild.id}), ${guild.memberCount} membres.`,
      `Salon Discord dédié IA : ${channel ? `#${channel.name} (ID ${channel.id})` : 'non configuré'}.`,
      `Demandeur : ${member.displayName} (ID ${discordUserId}), écrit depuis le dashboard web.`,
      `Date : ${new Date().toLocaleString('fr-FR')}.`,
    ]
      .filter(Boolean)
      .join('\n');

    const engines = await imageEnginesLine(this.router, this.integrations, guildId).catch(() => null);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt(locale, guild.name, channel?.name ?? 'web', [...openAiTools.map((tool) => tool.function.name), 'search_tools'], permissions, {
          guildMemories,
          memberMemories,
        }, recentActions, skillTriggers, serverRules, [...pinnedToolGuidance(relevant), ...(engines ? [engines] : [])]),
      },
      {
        role: 'user',
        content: `Contexte : cet échange vient du DASHBOARD WEB (pas de Discord). Un plan de confirmation s'affiche dans le salon Discord dédié IA.\n\n${contextBlock}\n\nDemande : ${trimmed}`,
      },
    ];

    const ctx: ToolRunContext = {
      guildId,
      channelId: channel?.id ?? null,
      userId: discordUserId,
      requestId,
      locale,
      permissions,
      reply: async () => {
        /* Le web collecte lui-même : pas d'envoi Discord pour ctx.reply. */
      },
      progress: async (text) => decision.note(text),
    };

    const executed: WebChatResult['tools'] = [];
    const note = (name: string, result: { ok: boolean; summary: string }): void => {
      const summary = result.summary.slice(0, TOOL_SUMMARY_MAX);
      executed.push({ name, ok: result.ok, summary });
      decision.step(name, { ok: result.ok, summary });
      if (tracked) this.progress.record(guildId, requestId, { name, ok: result.ok, summary });
    };
    // THINKING STABLE : l'effort et le modèle se décident une fois, avant le premier tour.
    const intent = detectRequestIntent(trimmed, relevant, skillTriggers);
    const plan = await this.llm.planRequest({ userId: discordUserId, guildId, cause: 'web' }, intent.action);
    let loopFailure: unknown = null;
    const outcome = await this.loop
      .run(messages, toolset, ctx, { userId: discordUserId, guildId, requestId, ...plan }, {
        cause: 'web',
        quotaExhaustedMessage: QUOTA_EXHAUSTED_MESSAGE,
        onToolResult: note,
      })
      .catch((error: unknown) => {
        loopFailure = error;
        this.log.warn(`chat web erreur : ${error instanceof Error ? error.message : String(error)}`);
        fileLog()?.event('error', 'loop', 'loop.error', { requestId, guildId, error: describeError(error), stack: stackExcerpt(error) });
        return null;
      });
    void this.decisions.record(
      guildId,
      decision.finish({
        intent,
        reasoning: plan.preferReasoning,
        effort: plan.reasoningEffort,
        turns: outcome?.turns ?? 0,
        usage: outcome?.usage ?? { promptTokens: 0, completionTokens: 0 },
        outcome: outcome ? outcomeOf({ finalText: outcome.finalText, error: outcome.error, quotaExhausted: outcome.quotaExhausted, forcedSummary: outcome.forcedSummary }) : 'failed',
        error: outcome ? outcome.error : loopFailure,
      }),
    );
    // La demande est finie pour le panel : réussie, ou en échec si la boucle n'a pas abouti.
    if (tracked) this.progress.finish(guildId, requestId, outcome ? 'done' : 'failed');
    // Fin de demande, comme sur Discord : les actions qui modifient, restées en attente,
    // forment UN plan, affiché dans le salon dédié IA du serveur.
    await getActionPlans()
      ?.flush(guildId, discordUserId, { content: trimmed, locale })
      .catch(() => null);

    // Comptabilité IA alignée sur le canal Discord (elle manquait côté web).
    if (outcome && outcome.usage.promptTokens + outcome.usage.completionTokens > 0) {
      this.audit.record({
        guildId,
        source: 'agent',
        action: 'llm.usage',
        actorId: discordUserId,
        metadata: {
          requestId,
          cause: 'web',
          promptTokens: outcome.usage.promptTokens,
          completionTokens: outcome.usage.completionTokens,
          turns: outcome.turns,
        },
      });
    }

    if (outcome?.finalText) {
      return { reply: outcome.finalText, silent: false, tools: executed };
    }
    const summary =
      executed.length > 0
        ? 'Actions exécutées, vérifie les résultats ci-dessus.'
        : "Je n'ai pas réussi à produire une réponse : réessaie.";
    return { reply: summary, silent: false, tools: executed };
  }
}
