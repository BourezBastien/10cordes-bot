import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, type Guild, type TextChannel } from 'discord.js';
import { AuditService } from '../audit/audit.service';
import { MemoryService } from '../memory/memory.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { LlmService, type ChatMessage, type OpenAiTool } from './llm.service';
import { fetchRecentActions } from './agent-history';
import { sanitizeTranscriptLine } from './reply-text';
import { buildSystemPrompt } from './system-prompt.builder';
import { selectRelevantTools, toolToOpenAiTool } from './tool-selection';
import { detectRequestIntent } from './request-intent';
import { AgentLoopService } from './agent-loop.service';
import { getSkillTriggers } from '../agent/skill.service';
import { GuildRulesService } from '../rules/guild-rules.service';
import { type ToolRunContext } from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';
import { permissionsOf } from '../../core/security/permission-name';

const RATE_LIMIT_MS = 4_000;
const MAX_MESSAGE_LENGTH = 2_000;
const TRANSCRIPT_SIZE = 12;

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
  ) {}

  async chat(guildId: string, discordUserId: string, message: string): Promise<WebChatResult> {
    const trimmed = message.trim();
    if (trimmed.length === 0) throw new Error('Message vide.');
    if (trimmed.length > MAX_MESSAGE_LENGTH) throw new Error('Message trop long (2000 caractères max).');

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
    const tools = await this.registry.listForGuild(guildId);
    // Même routing que Discord : noyau + pertinents, catalogue joignable via
    // search_tools (expansion dynamique dans AgentLoop).
    const relevant = selectRelevantTools(trimmed, tools);
    const byName = new Map<string, OpenAiTool>(tools.map((tool) => [tool.name, toolToOpenAiTool(tool)]));
    const openAiTools: OpenAiTool[] = relevant.map((tool) => byName.get(tool.name)!);
    const toolset = { active: openAiTools, byName };

    const [guildProfile, memberProfile, recentActions, skillTriggers, serverRules] = await Promise.all([
      this.memory.getGuildProfile(guildId).catch(() => null),
      this.memory.getMemberProfile(guildId, discordUserId).catch(() => null),
      fetchRecentActions(this.prisma, guildId, 12).catch(() => [] as string[]),
      getSkillTriggers(guildId)
        .then((skills) => skills.map((skill) => `${skill.id} | ${skill.trigger}`))
        .catch(() => [] as string[]),
      this.guildRules.describeForPrompt(guildId).catch(() => [] as string[]),
    ]);
    const guildMemories = guildProfile ? [`Fiche serveur consolidée : ${guildProfile}`] : [];
    const memberMemories = memberProfile ? [`Fiche du membre (consolidée) : ${memberProfile}`] : [];

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

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt(locale, guild.name, channel?.name ?? 'web', [...openAiTools.map((tool) => tool.function.name), 'search_tools'], permissions, {
          guildMemories,
          memberMemories,
        }, recentActions, skillTriggers, serverRules),
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
      locale,
      permissions,
      reply: async () => {
        /* Le web collecte lui-même : pas d'envoi Discord pour ctx.reply. */
      },
    };

    const executed: WebChatResult['tools'] = [];
    // THINKING STABLE : l'effort se décide une fois, avant le premier tour.
    const reasoningEffort = await this.llm.planReasoningEffort(
      { userId: discordUserId, guildId, cause: 'web' },
      detectRequestIntent(trimmed, relevant, skillTriggers).action,
    );
    const outcome = await this.loop
      .run(messages, toolset, ctx, { userId: discordUserId, guildId, reasoningEffort }, {
        cause: 'web',
        quotaExhaustedMessage: 'IA désactivée : crédits DeepSeek épuisés. Recharge le compte API.',
        onToolResult: (name, result) => {
          executed.push({ name, ok: result.ok, summary: result.summary.slice(0, 200) });
        },
      })
      .catch((error: unknown) => {
        this.log.warn(`chat web erreur : ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });

    // Comptabilité IA alignée sur le canal Discord (elle manquait côté web).
    if (outcome && outcome.usage.promptTokens + outcome.usage.completionTokens > 0) {
      this.audit.record({
        guildId,
        source: 'agent',
        action: 'llm.usage',
        actorId: discordUserId,
        metadata: {
          cause: 'web',
          promptTokens: outcome.usage.promptTokens,
          completionTokens: outcome.usage.completionTokens,
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
