import type { Client, Guild, GuildMember, TextChannel } from 'discord.js';
import type { BotTool, ToolRunContext } from '@10cordes/shared';
import type { AuditService } from '../audit/audit.service';
import { getSkillTriggers } from '../agent/skill.service';
import type { AgentLoopToolset } from './agent-loop.service';
import { fetchRecentActions } from './agent-history';
import type { ChatMessage, OpenAiTool } from './llm.service';
import type { PrismaService } from '../database/prisma.service';
import type { MemoryService } from '../memory/memory.service';
import type { GuildRulesService } from '../rules/guild-rules.service';
import type { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { botPermissionPolicy } from '../../core/security/bot-permission.policy';
import { permissionsOf } from '../../core/security/permission-name';
import { detectLocale } from '../../shared/utils/locale-detect';
import type { AgentRequest } from './queue/types';
import type { ReplySession } from './reply-session';
import { detectRequestIntent, type RequestIntent } from './request-intent';
import { sanitizeTranscriptLine } from './reply-text';
import { pinnedToolGuidance, selectRelevantTools, toolToOpenAiTool } from './tool-selection';
import { buildSystemPrompt } from './system-prompt.builder';
import { GuildIntegrationService } from '../integrations/guild-integration.service';
import { imageEnginesLine } from '../providers/image-engines';
import { CapabilityRouterService } from '../providers/capability-router.service';
import { fileLog } from '../logging/file-log.service';

const TRANSCRIPT_SIZE = 12;

/** Nom du webhook du rig E2E : seul message sans membre résolvable que la gate accepte. */
const E2E_GUARDIAN_NAME = 'agent-e2e-guardian';

export interface ConversationContextDeps {
  readonly client: Client;
  readonly registry: ToolRegistryService;
  readonly audit: AuditService;
  readonly memory: MemoryService;
  readonly prisma: PrismaService;
  readonly guildRules: GuildRulesService;
  readonly router: CapabilityRouterService;
  readonly integrations: GuildIntegrationService;
}

/** Tout ce que la boucle et la livraison doivent savoir d'une demande. */
export interface ConversationContext {
  readonly channel: TextChannel;
  readonly guild: Guild;
  readonly request: AgentRequest;
  readonly requestId: string;
  readonly locale: string;
  readonly permissions: string[];
  readonly session: ReplySession;
  readonly toolset: AgentLoopToolset;
  readonly runContext: ToolRunContext;
  readonly messages: ChatMessage[];
  /** Intention de la demande (action ou conversation), décidée avant le premier tour. */
  readonly intent: RequestIntent;
}

/** Fiches consolidées injectées dans le prompt système. */
interface MemoryContext {
  guildMemories: string[];
  memberMemories: string[];
}

/**
 * Prépare une demande avant la boucle LLM : permissions du demandeur, ligne
 * de statut, toolset routé, transcript, mémoire, règles du serveur, contexte
 * d'exécution des tools et messages. Aucune décision de réponse ici.
 */
export class ConversationContextBuilder {
  constructor(private readonly deps: ConversationContextDeps) {}

  async build(channel: TextChannel, guild: Guild, request: AgentRequest, requestId: string, session: ReplySession): Promise<ConversationContext> {
    const { prisma, guildRules } = this.deps;
    const locale = detectLocale(request.content);
    const member = await guild.members.fetch(request.userId).catch(() => null);
    const permissions = ConversationContextBuilder.resolvePermissions(request, member);

    // TOOL ROUTING (pattern Anthropic) : noyau volontairement PETIT +
    // pertinents forts ; le catalogue complet reste joignable via le tool
    // search_tools, qui ÉLARGIT le toolset actif à la volée (AgentLoop).
    const { toolset, routed } = await this.buildToolset(guild, request, requestId);

    const [transcript, memory, recentActions, skillTriggers, serverRules] = await Promise.all([
      this.buildTranscript(channel, request),
      this.loadMemoryContext(guild, request),
      fetchRecentActions(prisma, guild.id, 12).catch(() => [] as string[]),
      getSkillTriggers(guild.id)
        .then((skills) => skills.map((skill) => `${skill.id} | ${skill.trigger}`))
        .catch(() => [] as string[]),
      guildRules.describeForPrompt(guild.id).catch(() => [] as string[]),
    ]);

    // Fiches consolidées (compactes) plutôt que les entrées brutes : le
    // journal complet reste visible dans le dashboard et via get*Memory.
    // Consignes des tools épinglés, puis les moteurs d'image de CE serveur
    // (PixelLab, modèle d'IA routé) : l'agent arbitre sur ce qu'il a vraiment.
    const engines = await imageEnginesLine(this.deps.router, this.deps.integrations, guild.id).catch(() => null);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt(
          locale,
          guild.name,
          channel.name,
          [...toolset.active.map((tool) => tool.function.name), 'search_tools'],
          permissions,
          memory,
          recentActions,
          skillTriggers,
          serverRules,
          [...pinnedToolGuidance(routed), ...(engines ? [engines] : [])],
        ),
      },
      {
        role: 'user',
        content: `${this.buildContextBlock(channel, guild, request, transcript, locale)}\n\nDemande actuelle de [${request.authorName} (${request.userId})] : ${sanitizeTranscriptLine(request.content)}`,
      },
    ];

    return {
      channel,
      guild,
      request,
      requestId,
      locale,
      permissions,
      session,
      toolset,
      runContext: this.buildRunContext(channel, guild, request, member, locale, permissions, session, requestId),
      messages,
      intent: detectRequestIntent(request.content, routed, skillTriggers),
    };
  }

  /**
   * Permissions du demandeur. Rig E2E (R4 self-contained) : un message arrivé
   * jusqu'ici sans membre résolvable est un webhook du bot nommé
   * agent-e2e-guardian (la gate n'accepte QUE lui), il parle en staff.
   */
  private static resolvePermissions(request: AgentRequest, member: GuildMember | null): string[] {
    if (!member && request.authorName.toLowerCase() === E2E_GUARDIAN_NAME) return ['Administrator'];
    return permissionsOf(member);
  }

  /** Tools injectés au départ (noyau + pertinents), plus skipReply géré par la boucle. */
  private async buildToolset(guild: Guild, request: AgentRequest, requestId: string): Promise<{ toolset: AgentLoopToolset; routed: BotTool[] }> {
    const { registry, audit } = this.deps;
    const tools = await registry.listForGuild(guild.id);
    const relevant = selectRelevantTools(request.content, tools);
    const byName = new Map<string, OpenAiTool>(tools.map((tool) => [tool.name, toolToOpenAiTool(tool)]));
    const openAiTools: OpenAiTool[] = relevant.map((tool) => byName.get(tool.name)!);
    audit.record({
      guildId: guild.id,
      source: 'agent',
      action: 'tools.selected',
      actorId: request.userId,
      metadata: { requestId, kept: relevant.length, total: tools.length },
    });
    // Tool réservé au silence demandé : géré par la boucle, pas dans le registry.
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
    return { toolset: { active: openAiTools, byName }, routed: relevant };
  }

  /** Transcript horodaté du salon avant la demande : chaque ligne étiquetée par auteur. */
  private async buildTranscript(channel: TextChannel, request: AgentRequest): Promise<string> {
    const history = await channel.messages.fetch({ limit: TRANSCRIPT_SIZE, before: request.messageId });
    return [...history.values()]
      .reverse()
      .map((msg) => {
        const label = msg.author.bot
          ? `[${this.deps.client.user?.username ?? 'bot'} (${msg.author.id})]`
          : `[${msg.member?.displayName ?? msg.author.globalName ?? msg.author.username} (${msg.author.id})]`;
        return `${label} : ${sanitizeTranscriptLine(msg.content || '(sans texte)').slice(0, 200)}`;
      })
      .join('\n');
  }

  /** Situe la demande : salon, serveur, demandeur, date (formats locaux). */
  private buildContextBlock(channel: TextChannel, guild: Guild, request: AgentRequest, transcript: string, locale: string): string {
    return [
      `Historique récent du salon #${channel.name} :\n${transcript || '(salon vide)'}`,
      `Serveur : ${guild.name} (ID ${guild.id}), ${guild.memberCount} membres.`,
      `Salon actuel : #${channel.name} (ID ${channel.id}).`,
      `Demandeur : ${request.authorName} (ID ${request.userId}).`,
      `Date : ${new Date().toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US')}.`,
    ].join('\n');
  }

  /**
   * Profils consolidés des membres mentionnés dans la demande : répond à
   * « qui est X / tout ce que tu sais sur X » sans tool call supplémentaire.
   */
  private async loadMemoryContext(guild: Guild, request: AgentRequest): Promise<MemoryContext> {
    const { memory } = this.deps;
    const mentionedIds = [...request.content.matchAll(/<@(\d{15,21})>/g)].map((m) => m[1]).filter((id) => id !== request.userId).slice(0, 3);
    const mentionedProfiles = await Promise.all(
      mentionedIds.map(async (id) => ({ id, text: await memory.getMemberProfile(guild.id, id).catch(() => null) })),
    );
    const [guildProfile, memberProfile] = await Promise.all([
      memory.getGuildProfile(guild.id).catch(() => null),
      memory.getMemberProfile(guild.id, request.userId).catch(() => null),
    ]);
    const memberMemories = memberProfile ? [`Fiche du membre (consolidée) : ${memberProfile}`] : [];
    for (const mentioned of mentionedProfiles) {
      if (mentioned.text) memberMemories.push(`Fiche de <@${mentioned.id}> (consolidée) : ${mentioned.text}`);
    }
    return {
      guildMemories: guildProfile ? [`Fiche serveur consolidée : ${guildProfile}`] : [],
      memberMemories,
    };
  }

  /** Contexte d'exécution des tools : identité du demandeur, progression, réponses et fichiers. */
  private buildRunContext(
    channel: TextChannel,
    guild: Guild,
    request: AgentRequest,
    member: GuildMember | null,
    locale: string,
    permissions: string[],
    session: ReplySession,
    requestId: string,
  ): ToolRunContext {
    const { client } = this.deps;
    return {
      guildId: guild.id,
      channelId: channel.id,
      userId: request.userId,
      locale,
      permissions,
      roleIds: member ? [...member.roles.cache.keys()] : [],
      // Rien ne s'affiche pendant le traitement : la progression d'un tool long
      // (analyse, ingestion, génération) part dans le journal, pas dans le salon.
      progress: async (text) => {
        fileLog()?.event('info', 'tool', 'progress', { requestId, guildId: guild.id, text: String(text).slice(0, 200) });
      },
      reply: async (replyText) => {
        await channel.send({ content: replyText }).catch(() => {});
      },
      sendFile: async (file, targetChannelId) => {
        if (!client.user || !botPermissionPolicy.canInGuild(guild, 'AttachFiles')) {
          throw new Error(botPermissionPolicy.refusal('AttachFiles'));
        }
        const target = targetChannelId
          ? ((await client.channels.fetch(targetChannelId).catch(() => null)) as TextChannel | null)
          : channel;
        if (!target?.isTextBased() || !('send' in target)) throw new Error('Salon de destination introuvable.');
        const destination = target as TextChannel;
        await destination.send({ files: [{ name: file.name, attachment: Buffer.from(file.attachment) }] });
      },
    };
  }
}
