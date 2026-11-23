import { randomInt } from 'node:crypto';
import type { GuildMember } from 'discord.js';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { memberPermissionPolicy } from '../../core/security/member-permission.policy';
import type { ServerlifeToolsDeps } from './serverlife.tool-deps';

/** Tools d'animation du serveur : tirages au sort et activités vocales officielles. */

/** Tool members.pickRandom : tirage aléatoire parmi des réactants, un rôle ou tout le serveur. */
export function pickRandomTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'members.pickRandom',
    description:
      'Tirage aléatoire de membres : parmi les réactants 🎉 d\u0027un message, les membres d\u0027un rôle, ou tout le serveur. La primitive des tirages au sort composés (giveaways, quiz...).',
    category: 'serverlife',
    paramsSchema: z.object({
      scope: z.enum(['reactors', 'role', 'all']).default('all'),
      sourceId: z.string().optional().describe('scope=reactors : ID du message ; scope=role : ID du rôle'),
      count: z.number().int().min(1).max(20).default(1),
      excludeBots: z.boolean().default(true),
    }),
    requiredModules: [],
    destructive: false,
    systemPrompt:
      'Pour les tirages au sort composés : crée d\u0027abord une surface (surface.create) avec un bouton Participer dont le pipeline écrit dans la collection component_votes (record.write), liste les participants avec records.search, puis ce tool pour tirer. Exclut toujours les bots.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const guild = deps.guildOf(ctx);
      if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { scope, sourceId, count, excludeBots } = input as {
        scope?: 'reactors' | 'role' | 'all';
        sourceId?: string;
        count?: number;
        excludeBots?: boolean;
      };
      const take = count ?? 1;
      let candidates: string[] = [];
      let candidatesPartial = false;
      if (scope === 'reactors') {
        if (!sourceId) return { ok: false, summary: 'scope=reactors exige sourceId (ID du message).' };
        const channelId = ctx.channelId ?? '';
        const channel = deps.client.channels.cache.get(channelId);
        if (!channel || !('messages' in channel)) return { ok: false, summary: 'Salon introuvable.' };
        const message = await channel.messages.fetch(sourceId).catch(() => null);
        if (!message) return { ok: false, summary: 'Message introuvable.' };
        for (const reaction of message.reactions.cache.values()) {
          const users = await reaction.users.fetch().catch(() => null);
          if (!users) continue;
          for (const user of users.values()) {
            if (excludeBots && (user.bot || user.id === deps.client.user?.id)) continue;
            if (!candidates.includes(user.id)) candidates.push(user.id);
          }
        }
      } else {
        // guild.members.fetch() exige l'intent privilégié GuildMembers :
        // sans lui on replie sur le cache (membres déjà vus par le bot) au
        // lieu d'échouer, et le résultat dit que la liste est partielle.
        const fetched = await guild.members.fetch().catch(() => null);
        const members: GuildMember[] = fetched ? [...fetched.values()] : [...guild.members.cache.values()];
        const partial = fetched === null;
        candidates = members
          .filter((member) => {
            if (member.user?.bot) return false;
            if (scope === 'role' && sourceId) return memberPermissionPolicy.hasRole(member, sourceId);
            return true;
          })
          .map((member) => member.id);
        if (partial && candidates.length > 0) {
          candidatesPartial = true;
        }
      }
      const partialNote = candidatesPartial
        ? ' Connus du bot uniquement (liste des membres incomplète : active l\u0027intent privilégié « Membres du serveur » pour un tirage sur tous les membres).'
        : '';
      if (candidates.length === 0) {
        return {
          ok: false,
          summary: `Aucun candidat pour ce tirage (scope=${scope}${sourceId ? `, source ${sourceId}` : ''}).${partialNote}`,
        };
      }
      const winners: string[] = [];
      const pool = [...candidates];
      for (let i = 0; i < take && pool.length > 0; i += 1) {
        const index = randomInt(0, pool.length);
        winners.push(pool[index]);
        pool.splice(index, 1);
      }
      return {
        ok: true,
        summary:
          `Tirage parmi ${candidates.length} candidat(s) : ${winners.map((id) => `<@${id}>`).join(', ')}.${partialNote} ` +
          'Annonce les gagnants en UNE phrase (ne répète pas les conditions).',
        data: { winners, candidates: candidates.length, partial: candidatesPartial },
      };
    },
  };
}

/** Tool voice.activity : lance une activité Discord officielle dans le vocal courant. */
export function voiceActivityTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'voice.activity',
    description:
      'Lance une activité Discord officielle dans le vocal courant : chess, poker, watch (YouTube), betrayal, fishing, letter-tile, word-snack.',
    category: 'serverlife',
    paramsSchema: z.object({
      activity: z.enum(['chess', 'poker', 'watch', 'betrayal', 'fishing', 'letter-tile', 'word-snack']),
    }),
    requiredModules: [],
    destructive: false,
    systemPrompt:
      'Demande à l\u0027utilisateur d\u0027être en vocal, ou indique-le. L\u0027invitation s\u0027affiche dans le vocal ; l\u0027utilisateur clique pour lancer.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { activity } = input as { activity: string };
      const ids: Record<string, string> = {
        chess: '879863976203456297',
        poker: '755827207812677713',
        watch: '880218394199220332',
        betrayal: '773336526917861400',
        fishing: '814288819473020965',
        'letter-tile': '879863681317009951',
        'word-snack': '87986407010126432',
      };
      const appId = ids[activity];
      const guild = deps.guildOf(ctx);
      const member = guild ? await guild.members.fetch(ctx.userId).catch(() => null) : null;
      const voiceChannel = member?.voice.channel ?? null;
      if (!voiceChannel) return { ok: false, summary: 'Tu n\u0027es pas en vocal : rejoins un vocal puis redemande.' };
      const invite = await voiceChannel
        .createInvite({ targetApplication: appId, targetType: 2, maxAge: 86_400 })
        .catch(() => null);
      if (!invite) return { ok: false, summary: 'Impossible de créer l\u0027invitation d\u0027activité (permissions ?).' };
      return { ok: true, summary: `Activité **${activity}** prête : ${invite.url}` };
    },
  };
}
