import { PermissionFlagsBits, ChannelType, type Client, type Guild } from 'discord.js';
import { z } from 'zod';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import type { AgentService } from '../agent.service';
import type { ToolHelpers } from './discord.tools';

/**
 * Analyse le style du serveur pour l'imitation : catégories avec salons
 * enfants (noms, types, topics), permissions par salon, positions.
 * L'agent l'appelle AVANT toute création pour reproduire les conventions.
 */
/** État avant mutation : joint au résultat (data.preState) et archivé dans l'audit pour permettre un retour arrière. */
function withPreState(result: ToolResult, preState: Record<string, unknown>): ToolResult {
  return { ...result, data: { ...(result.data ?? {}), preState } };
}

function buildStyleGuide(guild: Guild): ToolResult {
  const channels = guild.channels.cache;
  const roleName = (id: string): string => (id === guild.id ? 'everyone' : (guild.roles.cache.get(id)?.name ?? id));

  const overwriteSummary = (channel: import('discord.js').NonThreadGuildBasedChannel): Array<Record<string, unknown>> =>
    channel.permissionOverwrites.cache
      .first(3)
      ?.map((overwrite) => ({
        role: roleName(overwrite.id),
        allow: overwrite.allow.toArray().slice(0, 3),
        deny: overwrite.deny.toArray().slice(0, 3),
      })) ?? [];

  const describeChannel = (channel: import('discord.js').NonThreadGuildBasedChannel): Record<string, unknown> => ({
    name: channel.name,
    type:
      channel.type === ChannelType.GuildText
        ? 'texte'
        : channel.type === ChannelType.GuildVoice
          ? 'vocal'
          : channel.type === ChannelType.GuildAnnouncement
            ? 'annonces'
            : channel.type === ChannelType.GuildForum
              ? 'forum'
              : 'autre',
    connectes: channel.type === ChannelType.GuildVoice ? channel.members.size : undefined,
    topic:
      (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) && channel.topic
        ? channel.topic.slice(0, 100)
        : undefined,
    permissions: overwriteSummary(channel),
  });

  const categories = channels
    .filter((channel): channel is import('discord.js').CategoryChannel => channel.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .first(12)
    .map((category) => ({
      categorie: category.name,
      position: category.rawPosition,
      permissions: overwriteSummary(category),
      salons: channels
        .filter(
          (channel): channel is import('discord.js').NonThreadGuildBasedChannel =>
            channel.parentId === category.id && !channel.isThread(),
        )
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .first(25)
        .map(describeChannel),
    }));

  const rootChannels = channels
    .filter(
      (channel): channel is import('discord.js').NonThreadGuildBasedChannel =>
        channel.parentId === null && channel.type !== ChannelType.GuildCategory && !channel.isThread(),
    )
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .first(12)
    .map(describeChannel);

  const roles = guild.roles.cache
    .filter((role) => !role.managed && role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .first(15)
    .map((role) => role.name);

  return {
    ok: true,
    summary: `Style du serveur : ${categories.length} catégories, ${channels.size} salons, ${roles.length} rôles listés. Imite ces conventions.`,
    data: { categories, sansCategorie: rootChannels, roles },
  };
}

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
  const { guildOf, noGuild } = helpers;
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
        const oldTopic = (channel as import('discord.js').TextChannel).topic ?? '';
        await (channel as unknown as { setTopic: (t: string, r: string) => Promise<unknown> }).setTopic(
          topic,
          `agent tool (by <@${ctx.userId}>)`,
        );
        return withPreState({ ok: true, summary: `Topic de <#${channel.id}> mis à jour.` }, { channelId: channel.id, oldTopic });
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
        const oldSlowmode = (channel as import('discord.js').TextChannel).rateLimitPerUser;
        await (channel as unknown as { setRateLimitPerUser: (s: number, r: string) => Promise<unknown> }).setRateLimitPerUser(
          seconds,
          `agent tool (by <@${ctx.userId}>)`,
        );
        return withPreState({ ok: true, summary: `Mode lent de <#${channel.id}> : ${seconds}s.` }, { channelId: channel.id, oldSlowmode });
      },
    },
    {
      name: 'getServerStyle',
      description:
        "Analyse la structure et le style du serveur : catégories (noms, positions), salons enfants (types, topics), permissions par salon, rôles. À appeler AVANT toute création ou modification pour imiter les conventions existantes.",
      category: 'agent',
      paramsSchema: z.record(z.string(), z.unknown()),
      requiredModules: [],
      destructive: false,
      systemPrompt:
        'Read-only. THE tool before any creation or edit: reproduce the detected conventions exactly (emoji prefixes, special unicode casing, separators, naming style) and reuse the permission schema of similar categories via setChannelOverwrite. After building something styled, save a one-line style summary with saveServerMemory so you remember it.',
      handler: async (_input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        return buildStyleGuide(guild);
      },
    },
    {
      name: 'setChannelOverwrite',
      description:
        "Définit les permissions d'un rôle sur un salon ou une catégorie (listes allow/deny de flags Discord). roleId = id du serveur pour @everyone.",
      category: 'agent',
      paramsSchema: z.object({
        channelId: z.string().min(1),
        roleId: z.string().min(1),
        allow: z.array(z.string()).max(30).default([]),
        deny: z.array(z.string()).max(30).default([]),
      }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: false,
      systemPrompt:
        "Tier 2 (reversible). Restricting access pattern: deny ['ViewChannel','Connect'] on @everyone (roleId = the GUILD id), then allow ['ViewChannel','Connect'] on each target role. Resolve role ids via getRoles. Only whitelist flags.",
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, roleId, allow = [], deny = [] } = input as {
          channelId: string;
          roleId: string;
          allow?: string[];
          deny?: string[];
        };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !('permissionOverwrites' in channel)) {
          return { ok: false, summary: 'Salon ou catégorie introuvable.' };
        }
        const me = guild.members.me;
        if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          return { ok: false, summary: "Le bot n'a pas la permission ManageRoles." };
        }
        // Object.hasOwn : `f in PermissionFlagsBits` acceptait aussi
        // 'toString', 'constructor', '__proto__' (propriétés héritées).
        const valid = (flags: string[]) =>
          flags.every((f) => Object.hasOwn(PermissionFlagsBits as Record<string, unknown>, f) && f !== 'Administrator');
        if (!valid(allow) || !valid(deny)) {
          return {
            ok: false,
            summary:
              'Flag inconnu (ou Administrator interdit). Valides : ViewChannel, SendMessages, ReadMessageHistory, Connect, Speak, Stream, CreateInstantInvite, AddReactions, EmbedLinks, AttachFiles, MentionEveryone, ManageChannels, ManageMessages, ManageRoles, ManageWebhooks, PrioritySpeaker, MoveMembers, MuteMembers, DeafenMembers.',
          };
        }
        const overwrite: Record<string, boolean> = {};
        for (const flag of allow) overwrite[flag] = true;
        for (const flag of deny) overwrite[flag] = false;
        const existing = (channel as import('discord.js').GuildChannel).permissionOverwrites.cache.get(roleId);
        const preOverwrite = existing
          ? { allow: existing.allow.toArray(), deny: existing.deny.toArray() }
          : { allow: [], deny: [] };
        await (channel as import('discord.js').GuildChannel).permissionOverwrites.edit(roleId, overwrite, {
          reason: `agent tool (by <@${ctx.userId}>)`,
        });
        const target = roleId === guild.id ? 'le rôle everyone' : `<@&${roleId}>`;
        return withPreState(
          {
            ok: true,
            summary: `Permissions de <#${channel.id}> pour ${target} : +[${allow.join(', ') || '∅'}] -[${deny.join(', ') || '∅'}].`,
            data: { channelId: channel.id, roleId },
          },
          { channelId: channel.id, roleId, oldOverwrite: preOverwrite },
        );
      },
    },
    {
      name: 'createCategory',
      description: 'Crée une catégorie (conteneur de salons), position optionnelle dans la liste des salons.',
      category: 'agent',
      paramsSchema: z.object({
        name: z.string().min(1).max(100),
        position: z.number().int().min(1).max(100).optional(),
      }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt:
        'Tier 2 (reversible). channel.list pour éviter les doublons ET pour imiter les conventions de nommage existantes. position = emplacement voulu dans la liste des catégories (1 = tout en haut) ; par défaut la catégorie va en bas.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { name, position } = input as { name: string; position?: number };
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return { ok: false, summary: "Le bot n'a pas la permission ManageChannels." };
        }
        const created = await guild.channels.create({ name, type: 4, reason: `agent tool (by <@${ctx.userId}>)` });
        if (position !== undefined) {
          await created.setPosition(position, { reason: `agent tool (by <@${ctx.userId}>)` }).catch(() => {});
        }
        return {
          ok: true,
          summary: `Catégorie **${name}** créée${position !== undefined ? ` en position ${position}` : ' (en bas de la liste)'}.`,
          data: { categoryId: created.id },
        };
      },
    },
    {
      name: 'moveChannel',
      description: "Déplace un salon dans une catégorie, ou à la racine du serveur si categoryId est omis.",
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), categoryId: z.string().min(1).optional() }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Resolve both via channel.list first. Omit categoryId to move the channel to the server root.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, categoryId } = input as { channelId: string; categoryId?: string };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return { ok: false, summary: 'Salon introuvable.' };
        const oldParentId = channel.parentId;
        if (categoryId === undefined || categoryId === null) {
          await (channel as unknown as { setParent: (id: null, opts: object) => Promise<unknown> }).setParent(null, { lockPermissions: false, reason: `agent tool (by <@${ctx.userId}>)` });
          return withPreState({ ok: true, summary: `<#${channelId}> déplacé à la racine du serveur.` }, { channelId, oldParentId });
        }
        const category = await guild.channels.fetch(categoryId).catch(() => null);
        if (!category || category.type !== 4) return { ok: false, summary: 'Catégorie introuvable.' };
        await (channel as unknown as { setParent: (id: string, opts: object) => Promise<unknown> }).setParent(categoryId, { lockPermissions: false, reason: `agent tool (by <@${ctx.userId}>)` });
        return withPreState({ ok: true, summary: `<#${channelId}> déplacé dans **${category.name}**.` }, { channelId, oldParentId });
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
        const oldName = role.name;
        await role.setName(name, `agent tool (by <@${ctx.userId}>)`);
        return withPreState({ ok: true, summary: `Rôle renommé en **${name}**.` }, { roleId, oldName });
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
      description: "Change le pseudo d\u2019un membre (ou réinitialise si vide). Le pseudo DU BOT : owner du serveur uniquement.",
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1), nickname: z.string().max(32).optional() }),
      requiredModules: [],
      permissions: ['ManageNicknames'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible) pour les membres. Le pseudo du BOT lui-même est protégé : seul le owner du serveur peut le changer, refuse poliment sinon.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId, nickname } = input as { userId: string; nickname?: string };
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { ok: false, summary: 'Membre introuvable.' };
        // Le pseudo du bot est protégé : owner uniquement (anti-troll).
        if (member.id === guild.members.me?.id && ctx.userId !== guild.ownerId) {
          return { ok: false, summary: 'Le pseudo du bot ne peut être changé que par le owner du serveur.' };
        }
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
          summary: `${member.displayName} (<@${member.id}>) : ${member.roles.cache.size - 1} rôle(s) : ${roles.join(' ') || 'aucun'}. Admin : ${member.permissions.has(PermissionFlagsBits.Administrator) ? 'oui' : 'non'}.`,
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
      permissions: ['SendMessages'],
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
      description: 'Lit les derniers messages d\u2019un salon (max 20) avec dates : auteur, âge, contenu.',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), limit: z.number().int().min(1).max(20).default(10) }),
      requiredModules: [],
      permissions: ['ViewChannel', 'ReadMessageHistory'],
      destructive: false,
      systemPrompt: 'Read-only. Les messages portent leur DATE (âge en jours) : tu peux calculer un seuil d\u0027inactivité. Ne prétends jamais qu\u0027un horodatage est indisponible.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, limit } = input as { channelId: string; limit?: number };
        const channel = await textChannelOf(guild, channelId);
        if (!channel) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
        const messages = await channel.messages.fetch({ limit: limit ?? 10 });
        const lines = [...messages.values()]
          .reverse()
          .map((m) => {
            const days = Math.floor((Date.now() - m.createdTimestamp) / 86_400_000);
            const age = days === 0 ? 'aujourd\u0027hui' : `${days}j`;
            return `[${m.author.username} (${age})] : ${(m.content || '(sans texte)').slice(0, 120)}`;
          });
        return { ok: true, summary: lines.join(' | ') || 'Salon vide.' };
      },
    },
    {
      name: 'analyzeActivity',
      description:
        'Analyse l\u2019activité réelle des salons texte : date du dernier message d\u2019un VRAI membre (bots/webhooks exclus) par salon, avec seuil en jours. Une seule commande pour « archive les salons morts depuis X jours ».',
      category: 'agent',
      paramsSchema: z.object({
        sinceDays: z.number().int().min(1).max(365).default(15).describe('Seuil d\u2019inactivité en jours'),
        categoryId: z.string().optional().describe('Limiter l\u2019analyse aux salons de cette catégorie'),
      }),
      requiredModules: [],
      permissions: ['ViewChannel'],
      destructive: false,
      systemPrompt:
        'Utile AVANT tout archivage : la colonne jours dit précisément quels salons dépassent le seuil. Ensuite déplace avec moveChannel vers la catégorie archive (ou crée-la d\u0029abord). Ne devine jamais l\u0027inactivité « à l\u0027œil » : cet outil donne les dates exactes.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { sinceDays, categoryId } = input as { sinceDays?: number; categoryId?: string };
        const threshold = sinceDays ?? 15;
        const channels = [...guild.channels.cache.values()].filter(
          (channel): channel is import('discord.js').TextChannel | import('discord.js').NewsChannel =>
            channel.isTextBased() && (!categoryId || channel.parentId === categoryId),
        );
        if (channels.length === 0) return { ok: false, summary: 'Aucun salon texte à analyser.' };

        // Progression dans LA ligne de statut du traitement (ctx.progress) :
        // jamais de messages dédiés, zéro spam.
        const update = async (text: string): Promise<void> => {
          await ctx.progress?.(text);
        };

        const now = Date.now();
        const results: Array<{ name: string; id: string; days: number | null }> = [];
        let scanned = 0;
        // Parallélisé par LOTS DE 8 (l'audit mesurait 1-2 min en séquentiel
        // sur les grosses guildes) : progression mise à jour à chaque lot.
        const scanChannel = async (channel: import('discord.js').TextChannel | import('discord.js').NewsChannel) => {
          const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
          let lastHumanDays: number | null = null;
          if (messages) {
            for (const message of messages.values()) {
              // Un vrai membre : ni bot ni webhook (les tests E2E passent par webhooks).
              if (message.author.bot || message.webhookId) continue;
              lastHumanDays = Math.floor((now - message.createdTimestamp) / 86_400_000);
              break;
            }
          }
          return { name: channel.name, id: channel.id, days: lastHumanDays };
        };
        const BATCH = 8;
        for (let i = 0; i < channels.length; i += BATCH) {
          const batch = await Promise.all(channels.slice(i, i + BATCH).map(scanChannel));
          results.push(...batch);
          scanned += batch.length;
          await update(`analyse : ${scanned}/${channels.length} salons`);
        }
        await update('analyse terminée');
        const dead = results.filter((r) => r.days === null || r.days >= threshold);
        const alive = results.length - dead.length;
        const deadLines = dead
          .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999))
          .slice(0, 25)
          .map((r) => `#${r.name} → ${r.days === null ? 'jamais de message membre' : `${r.days}j`}`);
        return {
          ok: true,
          summary:
            `${scanned} salon(s) analysé(s), seuil ${threshold}j : ${dead.length} inactif(s), ${alive} vivant(s). ` +
            `Inactifs : ${deadLines.join(' | ') || 'aucun'}. Déplace-les avec moveChannel (categoryName/ID cible).`,
          data: { threshold, scanned, deadIds: dead.map((r) => r.id) },
        };
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
          .map((b) => `<@${b.user.id}> (${b.user.username})${b.reason ? ` : ${b.reason.slice(0, 60)}` : ''}`)
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
    {
      name: 'announceStep',
      description: 'Poste une ligne d\u2019étape visible dans le salon (🔧) pour narrer un montage en cours.',
      category: 'agent',
      paramsSchema: z.object({
        message: z.string().min(3).max(200).describe('Étape en cours, ex : « Création des 3 catégories de tickets... »'),
      }),
      requiredModules: [],
      destructive: false,
      systemPrompt:
        'OBLIGATOIRE pendant les montages multi-étapes (tickets, panels, catégories, rôles, automatisations) : annonce chaque phase AVANT de l\u0027exécuter, puis fais le récap final dans ta réponse. Ne l\u0027utilise pas pour les réponses simples.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild || !ctx.channelId) return noGuild();
        const channel = await textChannelOf(guild, ctx.channelId);
        if (!channel) return { ok: false, summary: 'Salon de la demande introuvable.' };
        const { message } = input as { message: string };
        const sent = await channel.send({ content: `🔧 ${message}` }).then(() => true).catch(() => false);
        return sent
          ? { ok: true, summary: `Étape annoncée : ${message.slice(0, 80)}` }
          : { ok: false, summary: 'Annonce impossible (permissions du salon ?).' };
      },
    },
  ];
}

