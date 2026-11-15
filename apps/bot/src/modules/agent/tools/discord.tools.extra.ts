import { PermissionFlagsBits, type Client, type Guild } from 'discord.js';
import { z } from 'zod';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import type { AgentService } from '../agent.service';
import type { ToolHelpers } from './discord.tools';

/**
 * Tools Discord additionnels — surface complète de gestion :
 * réglages de salons, rôles fins, membres, messages, webhooks, émojis,
 * bans et journal d'audit. Même grille de tiers que le fichier principal.
 */
export function discordExtraTools(
  agent: AgentService,
  client: Client,
  helpers: ToolHelpers,
): BotTool[] {
  void agent;
  const { guildOf, noGuild, proposePlan } = helpers;
  type Ctx = ToolRunContext;

  const textChannelOf = async (guild: Guild, channelId: string) => {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    return channel && channel.isTextBased() && !channel.partial ? channel : null;
  };

  return [
    // ── Salons : réglages fins ────────────────────────────────────
    {
      name: 'setChannelTopic',
      description: "Change le sujet (topic) d'un salon texte.",
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), topic: z.string().max(1024) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Resolve the channel via channel.list first.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, topic } = input as { channelId: string; topic: string };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !('setTopic' in channel)) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
        await (channel as unknown as { setTopic: (t: string, r: string) => Promise<unknown> }).setTopic(
          topic,
          `agent tool (by <@${ctx.userId}>)`,
        );
        return { ok: true, summary: `Topic de <#${channel.id}> mis à jour.` };
      },
    },
    {
      name: 'setChannelSlowmode',
      description: "Définit le mode lent d'un salon (0 = off, max 6h).",
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), seconds: z.number().int().min(0).max(21600) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). 0 désactive le mode lent.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, seconds } = input as { channelId: string; seconds: number };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !('setRateLimitPerUser' in channel)) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
        await (channel as unknown as { setRateLimitPerUser: (s: number, r: string) => Promise<unknown> }).setRateLimitPerUser(
          seconds,
          `agent tool (by <@${ctx.userId}>)`,
        );
        return { ok: true, summary: `Mode lent de <#${channel.id}> : ${seconds}s.` };
      },
    },
    {
      name: 'createCategory',
      description: 'Crée une catégorie (conteneur de salons).',
      category: 'agent',
      paramsSchema: z.object({ name: z.string().min(1).max(100) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). channel.list pour éviter les doublons.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { name } = input as { name: string };
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return { ok: false, summary: "Le bot n'a pas la permission ManageChannels." };
        }
        const created = await guild.channels.create({ name, type: 4, reason: `agent tool (by <@${ctx.userId}>)` });
        return { ok: true, summary: `Catégorie **${name}** créée.`, data: { categoryId: created.id } };
      },
    },
    {
      name: 'moveChannel',
      description: 'Déplace un salon dans une catégorie.',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), categoryId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Resolve both via channel.list first.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, categoryId } = input as { channelId: string; categoryId: string };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        const category = await guild.channels.fetch(categoryId).catch(() => null);
        if (!channel || !category || category.type !== 4) return { ok: false, summary: 'Salon ou catégorie introuvable.' };
        await (channel as unknown as { setParent: (id: string, opts: object) => Promise<unknown> }).setParent(categoryId, { lockPermissions: false, reason: `agent tool (by <@${ctx.userId}>)` });
        return { ok: true, summary: `<#${channelId}> déplacé dans **${category.name}**.` };
      },
    },

    // ── Rôles : réglages fins ─────────────────────────────────────
    {
      name: 'renameRole',
      description: 'Renomme un rôle.',
      category: 'agent',
      paramsSchema: z.object({ roleId: z.string().min(1), name: z.string().min(1).max(100) }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Resolve the role via role.list first.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { roleId, name } = input as { roleId: string; name: string };
        const role = guild.roles.cache.get(roleId);
        if (!role) return { ok: false, summary: 'Rôle introuvable.' };
        await role.setName(name, `agent tool (by <@${ctx.userId}>)`);
        return { ok: true, summary: `Rôle renommé en **${name}**.` };
      },
    },
    {
      name: 'setRoleColor',
      description: "Change la couleur d'un rôle (entier hex : rouge=16711680, vert=65280, bleu=255).",
      category: 'agent',
      paramsSchema: z.object({ roleId: z.string().min(1), color: z.number().int().min(0).max(0xffffff) }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Convertis les couleurs nommées en entier hex toi-même.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { roleId, color } = input as { roleId: string; color: number };
        const role = guild.roles.cache.get(roleId);
        if (!role) return { ok: false, summary: 'Rôle introuvable.' };
        await role.setColor(color, `agent tool (by <@${ctx.userId}>)`);
        return { ok: true, summary: `Couleur de **${role.name}** mise à jour.` };
      },
    },
    {
      name: 'addRoleToMember',
      description: 'Attribue un rôle à un membre.',
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1), roleId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: false,
      systemPrompt: 'Tier 2. Le bot doit être au-dessus du rôle et du membre.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId, roleId } = input as { userId: string; roleId: string };
        const member = await guild.members.fetch(userId).catch(() => null);
        const role = guild.roles.cache.get(roleId);
        if (!member || !role) return { ok: false, summary: 'Membre ou rôle introuvable.' };
        await member.roles.add(role, `agent tool (by <@${ctx.userId}>)`);
        return { ok: true, summary: `<@&${roleId}> attribué à <@${userId}>.` };
      },
    },
    {
      name: 'removeRoleFromMember',
      description: 'Retire un rôle à un membre.',
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1), roleId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible via role.add).',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId, roleId } = input as { userId: string; roleId: string };
        const member = await guild.members.fetch(userId).catch(() => null);
        const role = guild.roles.cache.get(roleId);
        if (!member || !role) return { ok: false, summary: 'Membre ou rôle introuvable.' };
        await member.roles.remove(role, `agent tool (by <@${ctx.userId}>)`);
        return { ok: true, summary: `<@&${roleId}> retiré à <@${userId}>.` };
      },
    },
    {
      name: 'getRoleMembers',
      description: 'Liste les membres qui portent un rôle (max 25 mentions).',
      category: 'agent',
      paramsSchema: z.object({ roleId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { roleId } = input as { roleId: string };
        const role = guild.roles.cache.get(roleId);
        if (!role) return { ok: false, summary: 'Rôle introuvable.' };
        const members = role.members.map((m) => `<@${m.id}>`).slice(0, 25);
        return { ok: true, summary: `${role.members.size} membre(s) avec <@&${roleId}> : ${members.join(' ') || 'aucun'}` };
      },
    },

    // ── Membres ───────────────────────────────────────────────────
    {
      name: 'unbanMember',
      description: 'Déban un utilisateur par ID.',
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['BanMembers'],
      destructive: false,
      systemPrompt: 'Tier 2. Reversal of a ban.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId } = input as { userId: string };
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
          return { ok: false, summary: "Le bot n'a pas la permission BanMembers." };
        }
        await guild.members.unban(userId, `agent tool (by <@${ctx.userId}>)`);
        return { ok: true, summary: `<@${userId}> débanni.` };
      },
    },
    {
      name: 'setNickname',
      description: 'Change le pseudo d\u2019un membre (ou réinitialise si vide).',
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1), nickname: z.string().max(32).optional() }),
      requiredModules: [],
      permissions: ['ManageNicknames'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible).',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId, nickname } = input as { userId: string; nickname?: string };
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { ok: false, summary: 'Membre introuvable.' };
        await member.setNickname(nickname ?? null, `agent tool (by <@${ctx.userId}>)`);
        return { ok: true, summary: `Pseudo de <@${userId}> : ${nickname ?? 'réinitialisé'}.` };
      },
    },
    {
      name: 'getMemberInfo',
      description: 'Infos d\u2019un membre : pseudo, rôles, admin ou non.',
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1) }),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only. Utilise-le pour connaître le périmètre réel d\u2019un membre.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId } = input as { userId: string };
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { ok: false, summary: 'Membre introuvable (ou absent du serveur).' };
        const roles = member.roles.cache.filter((r) => r.id !== guild.id).map((r) => `<@&${r.id}>`).slice(0, 15);
        return {
          ok: true,
          summary: `${member.displayName} (<@${member.id}>) — ${member.roles.cache.size - 1} rôle(s) : ${roles.join(' ') || 'aucun'}. Admin : ${member.permissions.has(PermissionFlagsBits.Administrator) ? 'oui' : 'non'}.`,
          data: { id: member.id, nickname: member.displayName, roleCount: member.roles.cache.size - 1 },
        };
      },
    },
    {
      name: 'getMembers',
      description: 'Échantillon des membres du serveur (max 25).',
      category: 'agent',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (_input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const members = guild.members.cache.first(25).map((m) => `${m.displayName} (<@${m.id}>)`);
        return { ok: true, summary: `${guild.memberCount} membres au total. Échantillon : ${members.join(', ')}` };
      },
    },
    {
      name: 'sendDirectMessage',
      description: 'Envoie un message privé à un membre (max 1200 caractères).',
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1), content: z.string().min(1).max(1200) }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Prévient un membre discrètement. Les MP fermés renvoient une erreur claire.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId, content } = input as { userId: string; content: string };
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { ok: false, summary: 'Membre introuvable.' };
        await member.send({ content: `📨 De <@${ctx.userId}> : ${content}` });
        return { ok: true, summary: `MP envoyé à <@${userId}>.` };
      },
    },

    // ── Messages ──────────────────────────────────────────────────
    {
      name: 'sendMessage',
      description: 'Envoie un message dans un salon (max 1500 caractères).',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), content: z.string().min(1).max(1500) }),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Le bot doit avoir SendMessages dans le salon.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, content } = input as { channelId: string; content: string };
        const channel = await textChannelOf(guild, channelId);
        if (!channel) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
        const message = await channel.send({ content });
        return { ok: true, summary: `Message envoyé dans <#${channel.id}>.`, data: { messageId: message.id } };
      },
    },
    {
      name: 'deleteMessage',
      description: 'Supprime UN message précis (salon + id).',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), messageId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageMessages'],
      destructive: true,
      systemPrompt: 'DESTRUCTIVE irréversible : confirme avec l\u2019utilisateur avant d\u2019appeler.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, messageId } = input as { channelId: string; messageId: string };
        const channel = await textChannelOf(guild, channelId);
        if (!channel) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
        await channel.messages.delete(messageId);
        return { ok: true, summary: `Message supprimé dans <#${channel.id}>.` };
      },
    },
    {
      name: 'readMessages',
      description: 'Lit les derniers messages d\u2019un salon (max 10).',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), limit: z.number().int().min(1).max(10).default(5) }),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only. Vérifie le contenu d\u2019un salon avant/après une action.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, limit } = input as { channelId: string; limit?: number };
        const channel = await textChannelOf(guild, channelId);
        if (!channel) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
        const messages = await channel.messages.fetch({ limit: limit ?? 5 });
        const lines = [...messages.values()]
          .reverse()
          .map((m) => `[${m.author.username}] : ${(m.content || '(sans texte)').slice(0, 120)}`);
        return { ok: true, summary: lines.join(' | ') || 'Salon vide.' };
      },
    },

    // ── Webhooks ──────────────────────────────────────────────────
    {
      name: 'getWebhooks',
      description: 'Liste les webhooks du serveur (nom + salon).',
      category: 'agent',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: ['ManageWebhooks'],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (_input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const webhooks = await guild.fetchWebhooks();
        const lines = webhooks.map((w) => `**${w.name ?? 'sans nom'}** → <#${w.channelId}>`).slice(0, 15);
        return { ok: true, summary: `${webhooks.size} webhook(s) : ${lines.join(' | ') || 'aucun'}` };
      },
    },
    {
      name: 'createWebhook',
      description: 'Crée un webhook dans un salon.',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), name: z.string().min(1).max(80) }),
      requiredModules: [],
      permissions: ['ManageWebhooks'],
      destructive: false,
      systemPrompt: 'Tier 2.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, name } = input as { channelId: string; name: string };
        const channel = await textChannelOf(guild, channelId);
        if (!channel) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
        const webhook = await (channel as unknown as { createWebhook: (o: object) => Promise<{ id: string; name: string }> }).createWebhook({ name, reason: `agent tool (by <@${ctx.userId}>)` });
        return { ok: true, summary: `Webhook **${webhook.name}** créé dans <#${channel.id}>.`, data: { webhookId: webhook.id } };
      },
    },

    // ── Serveur : émojis, bans, audit ─────────────────────────────
    {
      name: 'getEmojis',
      description: 'Liste les émojis du serveur.',
      category: 'agent',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (_input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const emojis = guild.emojis.cache.map((e) => `${e} (\`${e.name}\`)`).slice(0, 25);
        return { ok: true, summary: `${guild.emojis.cache.size} émoji(s) : ${emojis.join(' ') || 'aucun'}` };
      },
    },
    {
      name: 'getBans',
      description: 'Liste les bans actifs du serveur.',
      category: 'agent',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: ['BanMembers'],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (_input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
          return { ok: false, summary: "Le bot n'a pas la permission BanMembers." };
        }
        const bans = await guild.bans.fetch();
        const lines = bans
          .map((b) => `<@${b.user.id}> (${b.user.username})${b.reason ? ` — ${b.reason.slice(0, 60)}` : ''}`)
          .slice(0, 15);
        return { ok: true, summary: `${bans.size} ban(s) : ${lines.join(' | ') || 'aucun'}` };
      },
    },
    {
      name: 'getAuditLogs',
      description: 'Lit les dernières entrées du journal d\u2019audit.',
      category: 'agent',
      paramsSchema: z.object({ limit: z.number().int().min(1).max(10).default(5) }),
      requiredModules: [],
      permissions: ['ViewAuditLog'],
      destructive: false,
      systemPrompt: 'Read-only. Répond à « qui a fait quoi ».',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { limit } = input as { limit?: number };
        const entries = await guild.fetchAuditLogs({ limit: limit ?? 5 });
        const lines = entries.entries.map((e) => {
          const executor = e.executor ? `<@${e.executor.id}>` : 'système';
          const target = e.targetId ? ` → \`${e.targetId}\`` : '';
          return `\`${e.actionType}\` par ${executor}${target}`;
        });
        return { ok: true, summary: lines.join(' | ') || 'Journal vide.' };
      },
    },
  ];
}

