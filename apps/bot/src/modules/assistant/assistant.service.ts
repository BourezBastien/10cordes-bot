import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, ContainerBuilder, MessageFlags, PermissionFlagsBits, type Message } from 'discord.js';
import { z } from 'zod';
import type { BotTool, ToolRunContext } from '@10cordes/shared';
import { LlmService, ProviderAuthError, ProviderUnavailableError, QuotaExhaustedError, type ChatMessage, type OpenAiTool } from './llm.service';
import { AgentLoopService } from './agent-loop.service';
import { DiscordProgressiveResponder } from './progressive-responder';
import { getSkillTriggers } from '../agent/skill.service';
import { notice, panel, text } from '../../shared/ui';
import { detectLocale } from '../../shared/utils/locale-detect';
import { ResponseCacheService } from './response-cache.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import type { GuildConfig } from '@10cordes/shared';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { V2Service } from '@spraxium/components';
import { AuditService } from '../audit/audit.service';
import { MemoryService } from '../memory/memory.service';
import { AssistantQueue } from './assistant.queue';
import { IntroContainer, type IntroData, ToolsListContainer, type ToolsData, TOOLS_PER_PAGE } from './v2.containers';
import { storeToolsPanel } from './tools.panel';
import { type AgentRequest } from './queue/types';
import { AppEnv } from '../../app.env';
import { PrismaService } from '../database/prisma.service';
import { GuildRulesService } from '../rules/guild-rules.service';
import { guildAdminPolicy } from '../../core/security/access-policy';
import { IntegrationStatusPresenter } from '../integrations/presenters/integration-status.presenter';
import { integrationOpenButton } from '../integrations/handlers/integration.handlers';
import { SkillPatternDetector } from '../agent/skill-pattern.detector';
import { CacheStoreService } from '../../shared/cache/cache-store.service';

const log = new Logger('Assistant');

const USER_COOLDOWN_MS = 4_000;
const TRANSCRIPT_SIZE = 12;
const TYPING_REFRESH_MS = 8_000;
/**
 * Silence demandé explicitement : filet déterministe en plus du tool skipReply
 * (le modèle peut l'ignorer ; cette détection, jamais).
 */
const SILENCE_REQUEST_RE = /sans\s+(?:me\s+)?répondre|ne\s+me\s+réponds\s+pas|without\s+(?:any\s+)?repl(?:y|ies)/i;

export function sanitizeTranscriptLine(content: string): string {
  return content.replace(/\[/g, '［').replace(/\]/g, '］');
}

// Le prompt système vit dans son builder (partie STATIQUE en tête pour le
// cache préfixe DeepSeek + partie dynamique) ; ré-export pour les
// consommateurs historiques (web-agent.service).
import { buildSystemPrompt } from './system-prompt.builder';
export { buildSystemPrompt };

function splitReplyChunks(content: string): string[] {
  const chunks: string[] = [];
  let rest = content;
  while (rest.length > 0) {
    chunks.push(rest.slice(0, 1200));
    rest = rest.slice(1200);
  }
  return chunks;
}

/**
 * Tools qui touchent à la structure du serveur : AVANT le premier appel,
 * un instantané complet (catégories, salons, rôles) est archivé en audit
 * (action 'server.snapshot') — la base immuable du retour arrière.
 */
const SNAPSHOT_TOOLS = new Set([
  'deleteChannel',
  'renameChannel',
  'moveChannel',
  'setChannelTopic',
  'setChannelSlowmode',
  'setChannelOverwrite',
  'archiveChannel',
  'deleteRole',
  'renameRole',
  'setRoleColor',
  'banMember',
  'kickMember',
]);

/**
 * Ligne de statut UNIQUE pendant le traitement : éditée en place, jamais
 * dupliquée. Format demandé par l'owner : préfixe de tag, zéro emoji.
 *   [THINKING] Je réfléchis...
 *   [TOOL] analyzeActivity : 24/48 salons...
 * Supprimée juste avant la réponse finale.
 */
class LiveStatus {
  private message: import('discord.js').Message | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly channel: { send: (opts: { content: string }) => Promise<import('discord.js').Message> }) {}

  /** Programme la ligne [THINKING] : postée seulement si rien ne répond en 3s. */
  arm(): void {
    this.timer = setTimeout(() => void this.post('[THINKING] Je réfléchis...'), 3_000);
    this.timer.unref?.();
  }

  /** Narration du texte intermédiaire d'une itération À tool_calls (R0.2) :
   * jamais publié comme réponse — la ligne [TOOL] le résume en direct. */
  async narrate(text: string): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const compact = text.replace(/\s+/gu, ' ').trim().slice(0, 90);
    if (compact.length === 0) return;
    await this.post(`[THINKING] ${compact}`);
  }

  /** Étape visible (appel de tool) : annule le timer et met à jour. */
  async step(toolName: string): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.post(`[TOOL] ${toolName}`);
  }

  /** Détail de progression DANS la ligne du tool (ex : 24/48 salons). */
  async detail(text: string): Promise<void> {
    await this.post(`[TOOL] ${text}`);
  }

  private async post(content: string): Promise<void> {
    if (this.message) {
      await this.message.edit({ content }).catch(() => {});
      return;
    }
    this.message = await this.channel.send({ content }).catch(() => null);
  }

  /** Supprime la ligne de statut (idempotent). */
  async done(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.message) {
      await this.message.delete().catch(() => {});
      this.message = null;
    }
  }
}

/** Noyau TOUJOURS injecté (routing Anthropic : volontairement PETIT — le
 * reste du catalogue est joignable via search_tools, qui élève le tool
 * trouvé dans le toolset actif à la volée). */
const TOOL_CORE_NAMES = new Set([
  'getServerInfo',
  'getChannels',
  'getMembers',
  'getMemberInfo',
  'sendMessage',
  'readMessages',
  'announceStep',
  'search_tools',
  'getAvailableTools',
  'searchInternet',
  'searchWikipedia',
  'saveServerMemory',
  'saveMemberMemory',
  'getMemberMemory',
]);

const MAX_INJECTED_TOOLS = 24;

/**
 * Sélection par pertinence : noyau structurel TOUJOURS inclus + les tools
 * dont nom/description/catégorie partagent des mots avec la demande.
 * Objectif : réduire la surface injectée (over-tooled agent = chute de
 * précision de sélection) sans jamais priver le modèle d'un tool critique.
 */
export function selectRelevantTools(content: string, tools: BotTool[]): BotTool[] {
  const words = new Set(
    content
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter((word) => word.length > 3),
  );
  const scored = tools.map((tool) => {
    if (TOOL_CORE_NAMES.has(tool.name)) return { tool, score: 1000 };
    const haystack = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
    let score = 0;
    for (const word of words) if (haystack.includes(word)) score += 1;
    return { tool, score };
  });
  const kept = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INJECTED_TOOLS)
    .map((entry) => entry.tool);
  for (const tool of tools) {
    if (TOOL_CORE_NAMES.has(tool.name) && !kept.includes(tool)) kept.push(tool);
  }
  return kept.length > 0 ? kept : tools;
}


/** Tool -> définition OpenAI (schéma Zod -> JSON Schema, fallback vide si irréductible). */
export function toolToOpenAiTool(tool: BotTool): OpenAiTool {
  let parameters: Record<string, unknown> = { type: 'object', properties: {} };
  try {
    parameters = z.toJSONSchema(tool.paramsSchema) as Record<string, unknown>;
  } catch {
    // Schéma non sérialisable : le modèle recevra une fonction sans paramètres.
  }
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters },
  };
}

/** Historique horodaté des dernières actions de l'agent sur ce serveur (audit). */
export async function fetchRecentActions(prisma: PrismaService, guildId: string, take = 12): Promise<string[]> {
  const rows = await prisma.auditLog
    .findMany({
      where: {
        guildId,
        OR: [
          { action: { startsWith: 'assistant.tool.' } },
          { action: { startsWith: 'agent.op.' } },
          { action: { startsWith: 'agent.plan.' } },
          { action: 'config.patch' },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: { action: true, metadata: true, createdAt: true },
    })
    .catch(() => []);
  return rows.map((row) => {
    let summary = '';
    try {
      const meta = JSON.parse(row.metadata ?? '{}');
      summary = meta.summary ?? meta.detail ?? (meta.title ? `« ${meta.title} »` : '');
    } catch {
      /* metadata vide */
    }
    const time = row.createdAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const short = row.action.replace('assistant.tool.', '').replace('agent.op.', 'op ');
    return `${time} : ${short}${summary ? ` → ${summary.slice(0, 90)}` : ''}`;
  });
}

/**
 * Agent conversationnel : mention / salon dédié IA / réponse à un de ses
 * messages → demande mise en file (durable) → traitée par un worker avec
 * réponse éphémère (portail) hors salon dédié, publique dans le salon dédié.
 */
@Injectable()
export class AssistantService {
  private readonly cooldowns = new Map<string, number>();

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
    private readonly integrationPresenter = new IntegrationStatusPresenter(),
    private readonly cacheStore: CacheStoreService,
  ) {
    queue.setProcessor((request) => this.processAgentRequest(request));
    this.registry.register(this.getLastSnapshotTool());
  }

  /**
   * Retourne le dernier instantané complet du serveur (archivé avant toute
   * action destructive) : source de vérité pour un retour arrière demandé.
   */
  private getLastSnapshotTool(): BotTool {
    return {
      name: 'getLastSnapshot',
      description: 'Récupère le dernier instantané complet du serveur (catégories, salons, rôles) archivé avant une modification destructive : la base exacte pour un retour arrière.',
      category: 'agent',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt:
        'Pour tout « remets comme avant / rollback » : compare ce snapshot à l\u0029état actuel (getServerStyle ou getChannels) puis restaure (renameChannel, moveChannel, setChannelOverwrite, createRole...). Jamais de « je ne peux pas revenir en arrière ».',
      handler: async (_input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const entry = await this.prisma.auditLog.findFirst({
          where: { guildId: ctx.guildId, action: 'server.snapshot' },
          orderBy: { id: 'desc' },
        });
        if (!entry) return { ok: false, summary: 'Aucun instantané archivé pour ce serveur.' };
        const meta = JSON.parse(entry.metadata || '{}') as { snapshot?: unknown; requestId?: string };
        const snapshot = meta.snapshot ?? {};
        return {
          ok: true,
          summary: `Dernier instantané archivé (demande ${meta.requestId ?? '?'}) : catégories/salons/rôles restaurables.`,
          data: { snapshot },
        };
      },
    };
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

  /** Processeur de la queue : toute la logique de l'agent sur un snapshot. */
  async processAgentRequest(request: AgentRequest): Promise<void> {
    const guild = this.client.guilds.cache.get(request.guildId) ?? (await this.client.guilds.fetch(request.guildId).catch(() => null));
    if (!guild) return;
    const channelMaybe = await this.client.channels.fetch(request.channelId).catch(() => null);
    if (!channelMaybe || !channelMaybe.isTextBased() || channelMaybe.partial) return;
    const channel = channelMaybe as import('discord.js').TextChannel;

    // Coalescing : si l'auteur a renvoyé un message PLUS RÉCENT dans le même
    // salon pendant la mise en file, on traite le plus récent (l'ancien reste
    // dans le transcript) — une seule réponse globale au lieu de deux à la suite.
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

    const guildConfig = await this.config.get(guild.id);

    // Salon dédié configuré ailleurs → redirection polie (portail éphémère).
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
      await this.processRequest(channel, guild, request, guildConfig, requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Assistant failure [${requestId}] user=${request.userId}: ${message}`);
      await channel
        .send(notice(`Erreur interne [${requestId}] : ${message.slice(0, 120)} — signale cette référence au staff si ça se répète.`, true))
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

  private async processRequest(
    channel: import('discord.js').TextChannel,
    guild: import('discord.js').Guild,
    request: AgentRequest,
    guildConfig: GuildConfig,
    requestId: string,
  ): Promise<void> {
    if (!this.llm.configured) {
      // A4 : délégation au Presenter — un SEUL message V2, plus de double
      // envoi ni de check ownerId inline (GuildAdminPolicy s'en charge).
      const member = await guild.members.fetch(request.userId).catch(() => null);
      const canConfigure = guildAdminPolicy.isAuthorized({
        userId: request.userId,
        guildOwnerId: guild.ownerId,
        permissions: member ? (member.permissions.toArray() as string[]) : [],
      });
      const payload = this.integrationPresenter.render({
        label: 'Fournisseur IA',
        connected: false,
        canConfigure,
      });
      const components = payload.components;
      if (canConfigure) {
        // Le bouton d'action est ajouté par le handler (pas dans le Presenter pur).
        components[0].addActionRowComponents(integrationOpenButton());
      }
      await channel
        .send({ flags: MessageFlags.IsComponentsV2, components })
        .catch(() => {});
      return;
    }

    // Mention nue ou pure salutation → panneau d'identité immédiat (sans LLM).
    const stripped = request.content.replace(/<@?\d+>/g, '').trim();
    const bareGreeting =
      stripped.length === 0 ||
      /^(salut|bonjour|hello|yo|hey|coucou|slt|bjr|ping|hi)[\s!.,?]*$/i.test(stripped);
    if (bareGreeting) {
      const member = await guild.members.fetch(request.userId).catch(() => null);
      const displayName = member?.displayName ?? request.authorName;
      const staff = guild.ownerId === request.userId || (member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false);
      const botName = this.client.user?.username ?? '10cordes';
      const introData: IntroData = {
        botName,
        displayName,
        staff,
        avatarUrl: this.client.user?.displayAvatarURL({ size: 128 }) ?? '',
        roleLine: staff
          ? `Ton **administrateur Discord délégué** : je pilote ton serveur de A à Z, sous tes ordres, ${displayName}.`
          : `L'**assistant IA du serveur** : pose tes questions, demande ton rang, navigue dans les tags, ${displayName}.`,
        permsLine:
          "Je vérifie toujours tes permissions avant d'agir, et je demande confirmation avant tout acte destructeur.",
        talkLines: [
          '- **Mentionne-moi** avec ta demande : `@10cordes active les logs`',
          '- **Écris simplement ici** : le salon dédié IA me relie directement',
          '- **Réponds** à l\u0027une de mes réponses pour continuer',
        ].join('\n'),
        exampleLines: staff
          ? [
              '- `configure les logs dans #logs` · `crée un salon annonces`',
              '- `bannis ce trouble-maker` (je demande confirmation) · `présente le serveur`',
              '- Le bouton **Panneau de configuration** ci-dessous · ',
            ].join('\n')
          : [
              '- `mon rang` · `le classement` · `montre-moi le tag règles`',
              '- Partage tes préférences : ma mémoire les retient',
              '- ',
            ].join('\n'),
        memoryLine:
          'Mémoire persistante · permissions vérifiées · confirmation humaine sur le destructeur',
      };
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

    // Boucle LLM : contexte complet, tools, portail éphémère ou salon dédié.
    await this.withTypingIndicator(channel, () => this.converse(channel, guild, request, guildConfig, requestId));
  }

  private async withTypingIndicator<T>(channel: import('discord.js').TextChannel, task: () => Promise<T>): Promise<T> {
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

  private async converse(
    channel: import('discord.js').TextChannel,
    guild: import('discord.js').Guild,
    request: AgentRequest,
    guildConfig: GuildConfig,
    requestId: string,
  ): Promise<void> {
    const locale = detectLocale(request.content);
    const member = await guild.members.fetch(request.userId).catch(() => null);
    let permissions: string[] = member ? (member.permissions.toArray() as string[]) : [];
    // Rig E2E (R4 self-contained) : un message arrivé jusqu'ici sans membre
    // résolvable est un webhook du bot nommé agent-e2e-guardian (la gate
    // n'accepte QUE lui) → il parle avec les permissions staff.
    if (!member && request.authorName.toLowerCase() === 'agent-e2e-guardian') {
      permissions = ['Administrator'];
    }

    // Ligne de statut vivante dès le début : [THINKING] après 3s, [TOOL] à
    // chaque appel, éditée en place, supprimée avant la réponse.
    const status = new LiveStatus(channel);
    status.arm();

    const tools = await this.registry.listForGuild(guild.id);
    // TOOL ROUTING (pattern Anthropic) : noyau volontairement PETIT +
    // pertinents forts ; le catalogue complet reste joignable via le tool
    // search_tools, qui ÉLARGIT le toolset actif à la volée (AgentLoop).
    const relevant = selectRelevantTools(request.content, tools);
    const byName = new Map<string, OpenAiTool>(tools.map((tool) => [tool.name, toolToOpenAiTool(tool)]));
    const openAiTools: OpenAiTool[] = relevant.map((tool) => byName.get(tool.name)!);
    this.audit.record({
      guildId: guild.id,
      source: 'agent',
      action: 'tools.selected',
      actorId: request.userId,
      metadata: { requestId, kept: relevant.length, total: tools.length },
    });
    // Tool réservé au silence demandé — géré par la boucle, pas dans le registry.
    const skipReplyTool: OpenAiTool = {
      type: 'function',
      function: {
        name: 'skipReply',
        description:
          "Ne rien répondre du tout. À appeler quand l'utilisateur demande explicitement d'agir sans réponse (ex: « purge les messages sans me répondre »).",
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    };
    openAiTools.push(skipReplyTool);
    byName.set('skipReply', skipReplyTool);
    const toolset = { active: openAiTools, byName };

    const history = await channel.messages.fetch({ limit: TRANSCRIPT_SIZE, before: request.messageId });
    const transcript = [...history.values()]
      .reverse()
      .map((msg) => {
        const label = msg.author.bot
          ? `[${this.client.user?.username ?? 'bot'} (${msg.author.id})]`
          : `[${msg.member?.displayName ?? msg.author.globalName ?? msg.author.username} (${msg.author.id})]`;
        return `${label} : ${sanitizeTranscriptLine(msg.content || '(sans texte)').slice(0, 200)}`;
      })
      .join('\n');

    const contextBlock = [
      `Historique récent du salon #${channel.name} :\n${transcript || '(salon vide)'}`,
      `Serveur : ${guild.name} (ID ${guild.id}), ${guild.memberCount} membres.`,
      `Salon actuel : #${channel.name} (ID ${channel.id}).`,
      `Demandeur : ${request.authorName} (ID ${request.userId}).`,
      `Date : ${new Date().toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US')}.`,
    ].join('\n');

    // Profils consolidés des membres mentionnés dans la demande : répond à
    // « qui est X / tout ce que tu sais sur X » sans tool call supplémentaire.
    const mentionedIds = [...request.content.matchAll(/<@(\d{15,21})>/g)].map((m) => m[1]).filter((id) => id !== request.userId).slice(0, 3);
    const mentionedProfiles = await Promise.all(
      mentionedIds.map(async (id) => ({ id, text: await this.memory.getMemberProfile(guild.id, id).catch(() => null) })),
    );

    const [guildProfile, memberProfile, recentActions, skillTriggers, serverRules] = await Promise.all([
      this.memory.getGuildProfile(guild.id).catch(() => null),
      this.memory.getMemberProfile(guild.id, request.userId).catch(() => null),
      fetchRecentActions(this.prisma, guild.id, 12).catch(() => [] as string[]),
      getSkillTriggers(guild.id)
        .then((skills) => skills.map((skill) => `${skill.id} | ${skill.trigger}`))
        .catch(() => [] as string[]),
      this.guildRules.describeForPrompt(guild.id).catch(() => [] as string[]),
    ]);
    // Fiches consolidées (compactes) plutôt que les entrées brutes : le
    // journal complet reste visible dans le dashboard et via get*Memory.
    const guildMemories = guildProfile ? [`Fiche serveur consolidée : ${guildProfile}`] : [];
    const memberMemories = memberProfile ? [`Fiche du membre (consolidée) : ${memberProfile}`] : [];
    for (const mentioned of mentionedProfiles) {
      if (mentioned.text) memberMemories.push(`Fiche de <@${mentioned.id}> (consolidée) : ${mentioned.text}`);
    }

    const ctx: ToolRunContext = {
      guildId: guild.id,
      channelId: channel.id,
      userId: request.userId,
      locale,
      permissions,
      roleIds: member ? [...member.roles.cache.keys()] : [],
      // Ligne de statut unique : les tools y publient leur progression au lieu
      // de poster leurs propres messages (fin du spam de lignes).
      progress: async (text) => status.detail(text),
      reply: async (replyText) => {
        await channel.send({ content: replyText }).catch(() => {});
      },
      sendFile: async (file, targetChannelId) => {
        if (!this.client.user || !guild.members.me?.permissions.has(PermissionFlagsBits.AttachFiles)) {
          throw new Error('Le bot n\u0027a pas la permission AttachFiles.');
        }
        const target = targetChannelId
          ? ((await this.client.channels.fetch(targetChannelId).catch(() => null)) as import('discord.js').TextChannel | null)
          : channel;
        if (!target?.isTextBased() || !('send' in target)) throw new Error('Salon de destination introuvable.');
        const destination = target as import('discord.js').TextChannel;
        await destination.send({ files: [{ name: file.name, attachment: Buffer.from(file.attachment) }] });
      },
    };

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt(locale, guild.name, channel.name, [...openAiTools.map((tool) => tool.function.name), 'search_tools'], permissions, {
          guildMemories,
          memberMemories,
        }, recentActions, skillTriggers, serverRules),
      },
      {
        role: 'user',
        content: `${contextBlock}\n\nDemande actuelle de [${request.authorName} (${request.userId})] : ${sanitizeTranscriptLine(request.content)}`,
      },
    ];

    let finalText: string | null = null;
    // Filet déterministe : la demande textuelle qui exige le silence force le flag.
    let silent = SILENCE_REQUEST_RE.test(request.content);
    const usage = { promptTokens: 0, completionTokens: 0 };
    const executed: string[] = [];
    const loopState: { error: Error | null } = { error: null };
    let snapshotTaken = false;
    // Réponse PROGRESSIVE : les deltas partent au responder ; si des
    // tool_calls ou un contenu interdit ([PANEL], @everyone) apparaissent,
    // le draft est annulé et la livraison finale classique prend le relais.
    let streamedText = '';
    let streamingActive = !silent;
    const responder = new DiscordProgressiveResponder(channel, request.messageId);

    // Cache de coûts : question identique posée récemment dans le serveur →
    // réponse cachée sans appel LLM (jamais pour les demandes d'action).
    if (!SILENCE_REQUEST_RE.test(request.content)) {
      const cachedReply = this.responseCache.get(guild.id, request.content);
      if (cachedReply) {
        log.info(`[FLOW] cache HIT pour ${request.authorName} [${requestId}]`);
        await status.done();
        // Réponse adressée comme les réponses fraîches (P1.11).
        await channel
          .send({ content: cachedReply, reply: { messageReference: request.messageId, failIfNotExists: false } })
          .catch(() => channel.send({ content: cachedReply }).catch(() => {}));
        this.audit.record({
          guildId: guild.id,
          source: 'agent',
          action: 'llm.cache.hit',
          actorId: request.userId,
          metadata: {},
        });
        return;
      }
    }

    // Boucle LLM + tools partagée avec le canal web (Template Method).
    const outcome = await this.loop
      .run(messages, toolset, ctx, { userId: request.userId, guildId: guild.id }, {
        cause: 'reply',
        quotaExhaustedMessage: 'IA désactivée : crédits DeepSeek épuisés. Recharge le compte API, je reprends dès que c\u0027est réglé.',
        onIterationStart: (iteration) => {
          log.info(`[FLOW][${requestId}] chat #${iteration + 1} : ${messages.length} messages en entrée`);
        },
        interceptToolCall: async (name) => {
          if (name === 'skipReply') {
            silent = true;
            streamingActive = false;
            void responder.abort();
            return { ok: true, summary: 'Compris : aucune réponse ne sera envoyée après les actions.' };
          }
          await status.step(name);
          // Premier tool structurel de la demande : instantané complet du
          // serveur en audit AVANT toute modification (rollback garanti).
          if (SNAPSHOT_TOOLS.has(name) && !snapshotTaken) {
            snapshotTaken = true;
            const snapshot = {
              at: new Date().toISOString(),
              categories: [...guild.channels.cache.values()]
                .filter((c) => !c.isThread() && c.type === 4)
                .map((c) => ({ id: c.id, name: c.name, position: (c as import('discord.js').GuildChannel).rawPosition })),
              channels: [...guild.channels.cache.values()]
                .filter((c) => !c.isThread() && c.type !== 4)
                .map((c) => ({ id: c.id, name: c.name, type: c.type, parent: c.parentId, position: (c as import('discord.js').GuildChannel).rawPosition })),
              roles: guild.roles.cache
                .filter((r) => r.name !== '@everyone')
                .map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.rawPosition })),
            };
            this.audit.record({
              guildId: guild.id,
              source: 'agent',
              action: 'server.snapshot',
              actorId: request.userId,
              metadata: { requestId, snapshot },
            });
          }
          return undefined;
        },
        onToolResult: (name, result) => {
          const resultData = result.data as { preState?: Record<string, unknown> } | undefined;
          this.audit.record({
            guildId: guild.id,
            source: 'agent',
            action: `assistant.tool.${name}`,
            actorId: request.userId,
            metadata: {
              ok: result.ok,
              summary: result.summary.slice(0, 200),
              preState: (resultData as Record<string, unknown> | undefined)?.preState ?? undefined,
            },
          });
          // P3.2 Learning Loop : empreinte d'intention (seuil 3, 14 j, ICacheStore).
          if (result.ok && !name.startsWith('search_') && !name.startsWith('get') && !name.startsWith('records.read')) {
            void this.patterns.record({
              store: this.cacheStore.active,
              guildId: guild.id,
              userId: request.userId,
              categories: [name.split('.')[0]],
              toolNames: [name],
              hadMutation: true,
            }).catch(() => {});
          }
        },
        onDelta: (text) => {
          if (!streamingActive) return;
          // R0.2 : ce callback ne reçoit QUE le texte d'un tour SANS
          // tool_calls (commit de fin d'itération par l'AgentLoop) — on peut
          // le pousser au responder d'un bloc (publication progressive).
          streamedText += text;
          if (/@everyone|@here|\[PANEL/i.test(streamedText)) {
            streamingActive = false;
            void responder.abort();
            return;
          }
          responder.push(text);
        },
        onIntermediateText: (text) => {
          void status.narrate(text);
        },
      })
      .catch((error: unknown) => {
        log.info(`[FLOW][${requestId}] boucle ERREUR : ${error instanceof Error ? error.message : String(error)}`);
        loopState.error = error instanceof Error ? error : new Error(String(error));
        return null;
      });

    if (outcome) {
      finalText = outcome.finalText;
      executed.push(...outcome.executed);
      usage.promptTokens += outcome.usage.promptTokens;
      usage.completionTokens += outcome.usage.completionTokens;
      if (outcome.quotaExhausted) {
        loopState.error = new QuotaExhaustedError();
      }
    }

    if (finalText === null) {
      if (loopState.error) {
        // Aucune erreur ne reste silencieuse : notice en salon + audit avec
        // requestId. Les erreurs génériques ne remontent plus au worker.
        const noticeFor = (message: string) => notice(`${message} [${requestId}]`, true);
        if (loopState.error instanceof QuotaExhaustedError) {
          this.audit.record({
            guildId: guild.id,
            source: 'agent',
            action: 'assistant.error',
            actorId: request.userId,
            metadata: { requestId, kind: 'quota' },
          });
          await status.done();
          await channel
            .send(noticeFor('IA désactivée : crédits DeepSeek épuisés. Recharge le compte API, je reprends dès que c\u0027est réglé.'))
            .catch(() => {});
          return;
        }
        if (loopState.error instanceof ProviderAuthError) {
          this.audit.record({
            guildId: guild.id,
            source: 'agent',
            action: 'assistant.error',
            actorId: request.userId,
            metadata: { requestId, kind: 'auth' },
          });
          await status.done();
          await channel
            .send(noticeFor('Configuration IA invalide (clé rejetée). Contacte le staff : la clé API doit être corrigée.'))
            .catch(() => {});
          return;
        }
        if (loopState.error instanceof ProviderUnavailableError) {
          this.audit.record({
            guildId: guild.id,
            source: 'agent',
            action: 'assistant.error',
            actorId: request.userId,
            metadata: { requestId, kind: 'provider' },
          });
          await status.done();
          await channel
            .send(noticeFor('Problème temporaire avec le fournisseur IA. Patiente quelques minutes et réessaie.'))
            .catch(() => {});
          return;
        }
        this.audit.record({
          guildId: guild.id,
          source: 'agent',
          action: 'assistant.error',
          actorId: request.userId,
            metadata: { requestId, kind: 'generic', error: loopState.error.message.slice(0, 300) },
          });
          await status.done();
          await channel.send(noticeFor(`Erreur IA : ${loopState.error.message.slice(0, 180)}`)).catch(() => {});
        return;
      }
      // Tools exécutés sans texte final : les résultats sont VISIBLES dans le
      // salon (salons créés, fichiers, panels) — aucun remplissage demandé.
      finalText = executed.length > 0 ? '' : 'Fait.';
    }

    // Comptabilité IA : un enregistrement par demande (somme des itérations).
    if (usage.promptTokens + usage.completionTokens > 0) {
      this.audit.record({
        guildId: guild.id,
        source: 'agent',
        action: 'llm.usage',
        actorId: request.userId,
        metadata: { requestId, cause: 'reply', promptTokens: usage.promptTokens, completionTokens: usage.completionTokens },
      });
    }

    // Présentation structurée demandée par le modèle ([PANEL]) → panneau V2.
    const panelRequested = /^\[PANEL\]\s*/i.test(finalText);
    if (panelRequested) {
      finalText = finalText.replace(/^\[PANEL\]\s*/i, '').trim();
    }

    // Silence demandé : les actions sont exécutées, aucun message n'est envoyé.
    if (silent) {
      this.audit.record({
        guildId: guild.id,
        source: 'agent',
        action: 'assistant.reply',
        actorId: request.userId,
        metadata: { requestId, locale, silent: true, tools: executed.join(',') },
      });
      await status.done();
      return;
    }

    // Tout part dans le salon, en texte simple (décision produit du 17/11 :
    // plus de réponses privées, DM ni portails). Le cache coûts ne s'applique
    // qu'aux réponses conversationnelles pures sans tools.
    // Garde deterministe : @everyone/@here ping uniquement si le demandeur est
    // admin (permission Administrator) ou owner. Sinon neutralise en texte.
    const isPrivileged = guild.ownerId === request.userId || permissions.includes('Administrator');
    let finalDelivery = finalText;
    if (!isPrivileged) {
      finalDelivery = finalDelivery.replaceAll('@everyone', '`everyone`').replaceAll('@here', '`here`');
    }

    // LIVRAISON PROGRESSIVE : le stream a déjà publié le texte en salon —
    // on finalise le message en cours, aucune re-poste.
    const progressivePublished = streamingActive && responder.published && finalDelivery.trim().length > 0;
    if (progressivePublished) {
      await responder.finalize();
      await status.done();
      this.audit.record({
        guildId: guild.id,
        source: 'agent',
        action: 'assistant.reply',
        actorId: request.userId,
        metadata: { requestId, locale, permissions: permissions.length, tools: executed.length, public: true, streamed: true },
      });
      return;
    }
    // Stream coupé en route (tool_calls, [PANEL], everyone) : jette le draft.
    await responder.abort();

    const chunks = splitReplyChunks(finalDelivery);
    await status.done();
    // Réponse ADRESSÉE : chaque morceau répond au message d'origine (reply
    // messageReference, failIfNotExists pour survivre à sa suppression) ;
    // fallback channel.send nu si le reply échoue (message source partielle,
    // permissions). Décision v3 : le bot ne « parle dans le vide » plus.
    let replied = false;
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      if (!replied) {
        const sent = await channel
          .send({ content: chunk, reply: { messageReference: request.messageId, failIfNotExists: false } })
          .then(() => true)
          .catch(() => false);
        replied = sent;
        if (sent) continue;
      }
      await channel.send({ content: chunk }).catch(() => {});
    }
    if (executed.length === 0 && chunks.length === 1 && chunks[0].trim()) {
      this.responseCache.put(guild.id, request.content, chunks[0]);
    }
    this.audit.record({
      guildId: guild.id,
      source: 'agent',
      action: 'assistant.reply',
      actorId: request.userId,
      metadata: { requestId, locale, permissions: permissions.length, tools: tools.length, public: true },
    });
  }
}
