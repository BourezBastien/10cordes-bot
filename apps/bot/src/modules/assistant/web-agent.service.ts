import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, PermissionFlagsBits, type Guild, type TextChannel } from 'discord.js';
import { AuditService } from '../audit/audit.service';
import { MemoryService } from '../memory/memory.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { LlmService, type ChatMessage, type OpenAiTool } from './llm.service';
import { buildSystemPrompt, fetchRecentActions, toolToOpenAiTool } from './assistant.service';
import { type ToolRunContext } from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';

const MAX_ITERATIONS = 8;
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
 * connecté), même mémoire. Les demandes destructives créent des plans dont le
 * panneau s'affiche dans le salon dédié IA de Discord (confirmation par boutons).
 */
@Injectable()
export class WebAgentService {
  private readonly log = new Logger('WebAgent');
  private readonly rateLimits = new Map<string, number>();

  constructor(
    private readonly llm: LlmService,
    private readonly registry: ToolRegistryService,
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
    const permissions = member.permissions.toArray() as string[];

    const guildConfig = await this.config.get(guildId).catch(() => null);
    const channelId = guildConfig?.assistant.channelId || null;
    const channel = channelId
      ? ((await this.client.channels.fetch(channelId).catch(() => null)) as TextChannel | null)
      : null;

    const locale = 'fr';
    const tools = await this.registry.listForGuild(guildId);
    const openAiTools: OpenAiTool[] = tools.map(toolToOpenAiTool);

    const [guildMemories, memberMemories, recentActions] = await Promise.all([
      this.memory.listGuild(guildId, 20).catch(() => [] as string[]),
      this.memory.listMember(guildId, discordUserId, 10).catch(() => [] as string[]),
      fetchRecentActions(this.prisma, guildId, 12).catch(() => [] as string[]),
    ]);

    const transcript = channel
      ? await channel.messages
          .fetch({ limit: TRANSCRIPT_SIZE })
          .then((collection) =>
            [...collection.values()]
              .reverse()
              .map((msg) => `[${msg.author.username} (${msg.author.id})] : ${(msg.content || '(sans texte)').slice(0, 200)}`)
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
        content: buildSystemPrompt(locale, guild.name, channel?.name ?? 'web', tools.map((tool) => tool.name), permissions, {
          guildMemories,
          memberMemories,
        }, recentActions),
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
    let silent = false;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const completion = await this.llm.chat(messages, openAiTools, { userId: discordUserId, guildId }).catch((error: unknown) => {
        this.log.warn(`chat web erreur : ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      if (!completion) break;

      if (completion.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: completion.content ?? '',
          reasoning_content: completion.reasoningContent ?? '',
          tool_calls: completion.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: call.arguments },
          })),
        });
        for (const call of completion.toolCalls) {
          let input: unknown = {};
          try {
            input = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            input = {};
          }
          const result = await this.registry.run(call.name, input, ctx);
          executed.push({ name: call.name, ok: result.ok, summary: result.summary.slice(0, 200) });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 4000),
          });
        }
        continue;
      }

      if (completion.content) {
        return { reply: completion.content, silent, tools: executed };
      }
      break;
    }

    void silent;
    const summary =
      executed.length > 0
        ? "Actions exécutées, vérifie les résultats ci-dessus."
        : "Je n'ai pas réussi à produire une réponse : réessaie.";
    return { reply: summary, silent, tools: executed };
  }
}
