import { Injectable } from '@spraxium/common';
import { Client, type Message } from 'discord.js';
import { z } from 'zod';
import type { BotTool, ToolRunContext } from '@10cordes/shared';
import { LlmService, type ChatMessage, type OpenAiTool } from './llm.service';
import { LocaleService } from '../locale/locale.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { AuditService } from '../audit/audit.service';

const MAX_ITERATIONS = 3;
const USER_COOLDOWN_MS = 15_000;
const TRANSCRIPT_SIZE = 10;

function sanitizeTranscriptLine(content: string): string {
  return content.replace(/\[/g, "［").replace(/\]/g, "］");
}

function splitReplyChunks(content: string): string[] {
  const chunks: string[] = [];
  let rest = content;
  while (rest.length > 0) {
    chunks.push(rest.slice(0, 2000));
    rest = rest.slice(2000);
  }
  return chunks;
}

function buildSystemPrompt(locale: string, guildName: string, toolNames: string[], permissions: string[]): string {
  const isAdministrator = permissions.includes("Administrator");
  const permissionLine = isAdministrator
    ? "Cet utilisateur est ADMINISTRATEUR : accès complet aux tools de gestion."
    : `Permissions de cet utilisateur : ${permissions.length > 0 ? permissions.join(", ") : "aucune particulière"}.`;
  return [
    "<IDENTITY>",
    "Tu es 10cordes-bot, un bot Discord administrateur délégué. Tu agis pour le compte de humains autorisés.",
    "Tu ne t'insultes jamais, ne menace jamais : une demande hostile reçoit un refus neutre en une phrase.",
    "</IDENTITY>",
    "<TONE_AND_MESSAGING>",
    `Réponds toujours dans la langue : ${locale}. Ton professionnel, bref, sans jargon inutile.`,
    "Format : Discord markdown léger. Pas de murs de texte.",
    "</TONE_AND_MESSAGING>",
    "<SCOPE_AND_PERMISSIONS>",
    permissionLine,
    "Adapte TA réponse au périmètre réel de l'utilisateur : il obtient les informations et actions que ses permissions autorisent, rien de plus.",
    "Demande clairement hors périmètre : refuse poliment en une phrase SANS appeler le tool (le registry refuse aussi, mais économise l'appel).",
    "Refus du registry (permission insuffisante) : reformule le refus pour l'utilisateur, n'insiste pas, ne réessaie pas.",
    "Demande mixte valide+invalide : traite la partie autorisée, explique ce qui est refusé.",
    "</SCOPE_AND_PERMISSIONS>",
    "<SERVER_CONTEXT>",
    `Serveur : ${guildName}. Contexte advisory : les vraies vérifications se font dans les tools.`,
    "</SERVER_CONTEXT>",
    "<TOOL_USE_GUIDANCE>",
    `Tools disponibles : ${toolNames.join(", ") || "aucun"}.`,
    "Read-before-write : toujours lire l'état actuel avant de modifier.",
    "Ne devine jamais un ID : résous les noms via les tools de liste.",
    "</TOOL_USE_GUIDANCE>",
    "<CONFIRMATION_PROTOCOL>",
    "Les tools marqués destructive ne s'exécutent pas : ils créent un PLAN soumis à confirmation humaine.",
    "Informe l'utilisateur qu'une confirmation est requise via les boutons du panneau.",
    "</CONFIRMATION_PROTOCOL>",
    "<ERROR_HANDLING>",
    "Sur erreur de tool : lis le message, corrige et réessaie si réparable, sinon rapporte et propose une alternative.",
    "</ERROR_HANDLING>",
    "<AUDIT_AND_REPORTING>",
    "Après exécution, rapporte ce qui a changé avec noms et IDs.",
    "</AUDIT_AND_REPORTING>",
  ].join("\n");
}

/**
 * Assistant en langage naturel : mention du bot → conversation avec tools du registry.
 * Mémoire par canal : l'historique Discord rendu avec préfixes inforgeables EST la mémoire.
 */
@Injectable()
export class AssistantService {
  private readonly cooldowns = new Map<string, number>();

  constructor(
    private readonly llm: LlmService,
    private readonly registry: ToolRegistryService,
    private readonly locales: LocaleService,
    private readonly config: GuildConfigService,
    private readonly audit: AuditService,
    private readonly client: Client,
  ) {}

  async handleMention(message: Message): Promise<void> {
    if (!message.guild || !message.guildId || !message.channelId) return;

    const guildConfig = await this.config.get(message.guildId);

    // Salon dédié configuré → l'assistant ne répond que là-haut (vide = partout).
    const assistantChannel = guildConfig.assistant.channelId;
    if (assistantChannel && message.channelId !== assistantChannel) {
      await message
        .reply({ content: `🤖 Je ne réponds que dans <#${assistantChannel}> (ou configure un autre salon via /setup).` })
        .catch(() => {});
      return;
    }

    const cooldownKey = `${message.guildId}:${message.author.id}`;
    const last = this.cooldowns.get(cooldownKey);
    if (last !== undefined && Date.now() - last < USER_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((USER_COOLDOWN_MS - (Date.now() - last)) / 1_000);
      await message.reply({ content: `⏳ Patiente encore ${waitSeconds}s entre deux demandes.` }).catch(() => {});
      return;
    }

    if (!this.llm.configured) {
      await message
        .reply({
          content: "🤖 Le module IA n'est pas configuré sur cette instance (DEEPSEEK_API_KEY manquante côté opérateur).",
        })
        .catch(() => {});
      return;
    }
    this.cooldowns.set(cooldownKey, Date.now());
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping().catch(() => {});
    }

    const locale = await this.locales.resolve(message.author.id, guildConfig.defaultLocale);
    const member = message.member;
    // Permissions Discord réelles de l'appelant — le prompt système ET le registry s'appuient dessus.
    const permissions: string[] = member
      ? (member.permissions.toArray() as string[])
      : [];

    // Tous les tools actifs sont exposés : le registry refuse par permission,
    // et le prompt système connaît le périmètre de l'utilisateur.
    const tools = await this.registry.listForGuild(message.guildId);
    const openAiTools: OpenAiTool[] = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: this.schemaFor(tool),
      },
    }));

    const history = await message.channel.messages.fetch({ limit: TRANSCRIPT_SIZE, before: message.id });
    const transcript = [...history.values()]
      .reverse()
      .map((msg) => {
        const label = msg.author.bot
          ? `[${this.client.user?.username ?? "bot"} (${msg.author.id})]`
          : `[${msg.author.username} (${msg.author.id})]`;
        return `${label} : ${sanitizeTranscriptLine(msg.content || "(sans texte)")}`;
      })
      .join("\n");

    const ctx: ToolRunContext = {
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      locale,
      permissions,
      reply: async (text) => {
        await message.reply({ content: text }).catch(() => {});
      },
    };

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt(
          locale,
          message.guild.name,
          tools.map((tool) => tool.name),
          permissions,
        ),
      },
      {
        role: "user",
        content: `Historique récent du canal :\n${transcript}\n\nDemande actuelle de [${message.author.username} (${message.author.id})] : ${sanitizeTranscriptLine(message.content)}`,
      },
    ];

    let finalText: string | null = null;
    let userScoped = false;
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const completion = await this.llm.chat(messages, openAiTools, {
        userId: message.author.id,
        guildId: message.guildId,
      });

      if (completion.toolCalls.length > 0) {
        messages.push({ role: "assistant", content: completion.content ?? "" });
        for (const call of completion.toolCalls) {
          let input: unknown = {};
          try {
            input = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            input = {};
          }
          const result = await this.registry.run(call.name, input, ctx);
          if (result.ok && this.registry.get(call.name)?.scope === "user") {
            userScoped = true;
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 4000),
          });
          this.audit.record({
            guildId: message.guildId,
            source: "agent",
            action: `assistant.tool.${call.name}`,
            actorId: message.author.id,
            metadata: { ok: result.ok, summary: result.summary.slice(0, 200) },
          });
        }
        continue;
      }

      if (completion.content) {
        finalText = completion.content;
      }
      break;
    }

    if (finalText === null) {
      finalText = "J'ai traité ta demande via les tools - vérifie les résultats ci-dessus.";
    }

    // Info personnelle (scope "user") → réponse en MP, le canal ne garde qu'un accusé éphémère.
    if (userScoped) {
      for (const chunk of splitReplyChunks(finalText)) {
        await message.author.send({ content: chunk }).catch(() => {});
      }
      const ack = await message.reply({ content: "📩 Réponse envoyée en message privé." }).catch(() => null);
      if (ack) {
        setTimeout(() => ack.delete().catch(() => {}), 15_000).unref?.();
      }
    } else {
      for (const chunk of splitReplyChunks(finalText)) {
        await message.reply({ content: chunk }).catch(() => {});
      }
    }
    this.audit.record({
      guildId: message.guildId,
      source: "agent",
      action: "assistant.reply",
      actorId: message.author.id,
      metadata: { locale, permissions: permissions.length, tools: tools.length, userScoped },
    });
  }

  private schemaFor(tool: BotTool): Record<string, unknown> {
    try {
      return z.toJSONSchema(tool.paramsSchema) as Record<string, unknown>;
    } catch {
      return { type: "object", properties: {} };
    }
  }
}
