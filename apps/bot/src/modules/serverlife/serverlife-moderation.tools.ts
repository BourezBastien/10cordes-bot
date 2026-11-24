import { ChannelType } from 'discord.js';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { botPermissionPolicy } from '../../core/security/bot-permission.policy';
import { guildAccessContext, guildAdminPolicy } from '../../core/security/access-policy';
import type { ServerlifeToolsDeps } from './serverlife.tool-deps';

/**
 * Tools de modération et de protection : investigation (snipe), anti-raid
 * (lockdown, dehoist), confiance et sanction temporaire.
 */

// Symboles ASCII hoistables + espaces insécables, écrits en échappements
// unicode purs (aucun caractère littéral ambigu dans la classe).
const HOIST_CHARS = /^[\u00a0\u200b-\u200d\u2060\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007f\s]+/u;

/** Préfixe hoistable d'un pseudo (symboles, espaces insécables), null s'il n'en a pas. */
function parseHoist(name: string): string | null {
  const match = name.match(HOIST_CHARS);
  return match ? match[0] : null;
}

/**
 * Score de confiance (0-1000) : 1000 moins la somme pondérée des sanctions,
 * chaque sanction décroissant exponentiellement (demi-vie 30 jours :
 * facteur Math.exp(-0.0231 * jours), 0.0231 = ln(2)/30).
 */
function trustScore(cases: Array<{ action: string; createdAt: Date }>): number {
  const weights: Record<string, number> = {
    warn: 40,
    timeout: 120,
    kick: 200,
    ban: 400,
    derank: 150,
  };
  let penalty = 0;
  const now = Date.now();
  for (const modCase of cases) {
    const weight = weights[modCase.action] ?? 60;
    const daysAgo = (now - modCase.createdAt.getTime()) / 86_400_000;
    penalty = penalty + weight * Math.exp(-0.0231 * daysAgo);
  }
  const raw = 1000 - penalty;
  return Math.max(0, Math.min(1000, Math.round(raw)));
}

/** Tool snipe : derniers messages supprimés ou édités d'un salon (cache mémoire, staff-only). */
export function snipeTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'snipe',
    description: 'Montre les derniers messages supprimés ou édités d\u0027un salon (cache mémoire, réservé au staff).',
    category: 'serverlife',
    paramsSchema: z.object({ channelId: z.string().min(1).optional() }),
    requiredModules: [],
    permissions: ['ManageMessages'],
    destructive: false,
    systemPrompt: 'Outil d\u0027investigation de modération : montre ce qui a été effacé/modifié récemment.',
    handler: async (input, ctx) => {
      const guild = deps.guildOf(ctx);
      if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { channelId } = input as { channelId?: string };
      const target = channelId ?? ctx.channelId;
      if (!target) return { ok: false, summary: 'Salon introuvable.' };
      const entries = deps.store.recentSnipes(target);
      if (entries.length === 0) return { ok: true, summary: 'Aucun message supprimé/édité en mémoire pour ce salon.' };
      const lines = entries.slice(-5).map((entry) => `[${entry.author} · ${entry.action}] : ${entry.content.slice(0, 120)}`);
      return { ok: true, summary: `Derniers effacements : ${lines.join(' | ')}` };
    },
  };
}

/** Tool lockdown : verrouille ou déverrouille les salons texte (anti-raid). */
export function lockdownTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'lockdown',
    description:
      'Verrouille (ou déverrouille) instantanément les salons texte du serveur : deny/restore SendMessages à @everyone. Outil anti-raid.',
    category: 'serverlife',
    paramsSchema: z.object({
      action: z.enum(['lock', 'unlock']),
      scope: z.enum(['all', 'category']).default('all'),
      categoryId: z.string().optional().describe('Si scope=category'),
    }),
    requiredModules: [],
    permissions: ['ManageChannels', 'ManageRoles'],
    destructive: true,
    systemPrompt:
      'OUTIL D\u0027URGENCE anti-raid. lock : deny SendMessages partout ; unlock : restaure exactement l\u0027état pré-lock (mémorisé en mémoire).',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const guild = deps.guildOf(ctx);
      if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { action, categoryId } = input as { action: 'lock' | 'unlock'; scope?: 'all' | 'category'; categoryId?: string };
      const channels = [...guild.channels.cache.values()].filter(
        (channel) => channel.type === ChannelType.GuildText && (!categoryId || channel.parentId === categoryId),
      );
      if (channels.length === 0) return { ok: false, summary: 'Aucun salon texte à traiter.' };
      let touched = 0;
      if (action === 'lock') {
        const previouslyOpen = channels.filter(
          (channel) => !botPermissionPolicy.isDeniedToEveryone(channel as import('discord.js').GuildChannel, 'SendMessages'),
        );
        for (const channel of channels) {
          await (channel as import('discord.js').GuildChannel)
            .permissionOverwrites.edit(guild.id, { SendMessages: false }, { reason: 'lockdown' })
            .catch(() => {});
        }
        deps.store.rememberOpenChannels(ctx.guildId, new Set(previouslyOpen.map((channel) => channel.id)));
        return { ok: true, summary: `Lockdown : ${channels.length} salon(s) verrouillé(s). Unlock pour restaurer l\u0027état pré-lock.` };
      }
      const previouslyOpen = deps.store.openChannelsBeforeLock(ctx.guildId);
      for (const channel of channels) {
        const wasOpen = !previouslyOpen || previouslyOpen.has(channel.id);
        await (channel as import('discord.js').GuildChannel)
          .permissionOverwrites.edit(guild.id, { SendMessages: wasOpen ? true : null }, { reason: 'lockdown release' })
          .catch(() => {});
        touched += 1;
      }
      deps.store.forgetLock(ctx.guildId);
      return { ok: true, summary: `Unlock : ${touched} salon(s) restauré(s) à l\u0027état pré-lock.` };
    },
  };
}

/** Tool dehoist : renomme les pseudos qui commençent par un caractère hoistable. */
export function dehoistTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'dehoist',
    description: 'Renomme les pseudos commençant par un caractère hoistable (symboles) avec un préfixe neutre.',
    category: 'serverlife',
    paramsSchema: z.object({ prefix: z.string().min(1).max(6).default('⬇') }),
    requiredModules: [],
    permissions: ['ManageNicknames'],
    destructive: false,
    systemPrompt: 'Anti-hoist : les membres renommés peuvent rechanger leur pseudo ensuite. Rapporte le nombre traité.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const guild = deps.guildOf(ctx);
      if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { prefix } = input as { prefix?: string };
      const members = await guild.members.fetch().catch(() => null);
      if (!members) return { ok: false, summary: 'Fetch des membres impossible.' };
      let renamed = 0;
      for (const member of members.values()) {
        if (member.user.bot || guildAdminPolicy.isOwner(guildAccessContext(guild, member.id, member))) continue;
        if (!member.manageable) continue;
        const hoist = parseHoist(member.displayName);
        if (!hoist) continue;
        await member.setNickname(`${prefix || '⬇'} ${member.user.username}`.slice(0, 32), 'dehoist').catch(() => {});
        renamed += 1;
      }
      return { ok: true, summary: `Dehoist : ${renamed} membre(s) renommé(s).` };
    },
  };
}

/** Tool member.trust : score de confiance d'un membre, dérivé de ses cases de modération. */
export function memberTrustTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'member.trust',
    description: 'Score de confiance 0-1000 d\u0027un membre : dérivé de ses cases de modération avec décroissance exponentielle (demi-vie 30 jours).',
    category: 'serverlife',
    paramsSchema: z.object({ userId: z.string().min(1) }),
    requiredModules: [],
    permissions: ['ManageGuild'],
    destructive: false,
    systemPrompt:
      'Consulte AVANT une décision de modération : score < 400 = historique lourd récent ; score élevé = membre fiable. Calcul dérivé des cases (jamais stocké) : idempotent.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { userId } = input as { userId: string };
      const cases = await deps.prisma.modCase.findMany({
        where: { guildId: ctx.guildId, userId },
        select: { action: true, createdAt: true },
      });
      const score = trustScore(cases);
      return {
        ok: true,
        summary: `Score de confiance de <@${userId}> : **${score}/1000** (${cases.length} case(s) de modération prisent en compte).`,
        data: { score, cases: cases.length },
      };
    },
  };
}

/** Tool temp.sanction : sanction temporaire (timeout, rôle ou ban), révoquée automatiquement à échéance. */
export function tempSanctionTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'temp.sanction',
    description:
      'Applique une sanction TEMPORAIRE auto-révoquée : tempmute (timeout Discord), temprole (rôle retiré après), tempban (unban après). Révocation planifiée en DB + sweep toutes les 5 min : survit aux redémarrages et s\'exécute pendant l\'uptime.',
    category: 'serverlife',
    paramsSchema: z.object({
      userId: z.string().min(1),
      type: z.enum(['timeout', 'role', 'ban']),
      durationMinutes: z.number().int().min(1).max(40_320),
      roleId: z.string().optional().describe('Requis si type=role'),
      reason: z.string().max(400).optional(),
    }),
    requiredModules: [],
    permissions: ['ModerateMembers', 'ManageRoles'],
    destructive: true,
    systemPrompt:
      'La révocation est AUTOMATIQUE (sweep périodique) : ne promets jamais de lever la sanction à la main. Consulte member.trust avant si le doute.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const guild = deps.guildOf(ctx);
      if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { userId, type, durationMinutes, roleId, reason } = input as {
        userId: string;
        type: 'timeout' | 'role' | 'ban';
        durationMinutes: number;
        roleId?: string;
        reason?: string;
      };
      const member = await guild.members.fetch(userId).catch(() => null);
      // L'action Discord d'abord, avec son échec PROPAGÉ : l'ancien
      // .catch vide créait la ligne de révocation pour une sanction
      // jamais appliquée (réponse « sanction appliquée » mensongère).
      if (type === 'role') {
        if (!roleId) return { ok: false, summary: 'type=role exige roleId.' };
        if (!member) return { ok: false, summary: 'Membre introuvable.' };
        const applied = await member.roles.add(roleId, reason ?? 'sanction temporaire').then(() => true).catch(() => false);
        if (!applied) return { ok: false, summary: 'Ajout du rôle impossible (hiérarchie ou permissions du bot ?).' };
      } else if (type === 'timeout') {
        if (!member) return { ok: false, summary: 'Membre introuvable.' };
        const applied = await member.timeout(durationMinutes * 60_000, reason ?? 'sanction temporaire').then(() => true).catch(() => false);
        if (!applied) return { ok: false, summary: 'Timeout impossible (hiérarchie ou permissions du bot ?).' };
      } else {
        const applied = await guild.members.ban(userId, { reason: reason ?? 'sanction temporaire' }).then(() => true).catch(() => false);
        if (!applied) return { ok: false, summary: 'Ban impossible (hiérarchie ou permissions du bot ?).' };
      }
      const revokeAt = new Date(Date.now() + durationMinutes * 60_000);
      await deps.prisma.tempSanction.create({
        data: {
          guildId: ctx.guildId,
          userId,
          type,
          payload: JSON.stringify({ roleId }),
          revokeAt,
          createdBy: ctx.userId,
        },
      });
      return {
        ok: true,
        summary:
          `Sanction temporaire (${type}) appliquée à <@${userId}> pour ${durationMinutes} min. ` +
          `Révocation automatique <t:${Math.floor(revokeAt.getTime() / 1000)}:R>.`,
        data: { revokeAt: revokeAt.toISOString() },
      };
    },
  };
}
