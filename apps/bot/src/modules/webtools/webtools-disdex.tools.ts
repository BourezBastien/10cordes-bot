import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { safeFetchJson } from '../../shared/utils/safe-fetch';

/**
 * Tools de l'index public disdex : recherche de serveur, résolution d'une
 * invitation, fiche d'un utilisateur indexé. Ordre d'origine dans le
 * registry : discordServerLookup, discordInviteResolve, discordUserLookup.
 */
export function buildDisdexTools(): BotTool[] {
  return [
    {
      name: 'discordServerLookup',
      description:
        'Cherche un serveur Discord public sur l\u0027index disdex (nom, tag, description) : membres, en ligne, boosts, langue, lien d\u0027invitation.',
      category: 'web',
      paramsSchema: z.object({ query: z.string().min(3).max(100) }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Source : disdex.io. Cite-la. Utile pour comparer des communautés ou vérifier un serveur.',
      handler: async (input, _ctx) => {
        const { query } = input as { query: string };
        const data = await safeFetchJson<{ data?: Array<{ name: string; members: number; online: number; description: string; invite_url: string }> }>(
          `https://disdex.io/api/v1/servers?q=${encodeURIComponent(query)}&limit=5`,
        );
        const list = data?.data ?? [];
        if (list.length === 0) return { ok: false, summary: 'Aucun serveur trouvé sur disdex.' };
        const lines = list.map(
          (server) =>
            `${server.name} (${server.members.toLocaleString('fr-FR')} membres, ${server.online.toLocaleString('fr-FR')} en ligne) : ${server.description?.slice(0, 80) ?? ''} ${server.invite_url ?? ''}`,
        );
        return { ok: true, summary: `Serveurs disdex pour « ${query} » : ${lines.join(' | ')}` };
      },
    },
    {
      name: 'discordInviteResolve',
      description:
        'Résout un code d\u0027invitation Discord : serveur cible, invitation vivante ou morte, alternatives vivantes du même serveur.',
      category: 'web',
      paramsSchema: z.object({ invite: z.string().min(2).max(60).describe('Code ou lien discord.gg/...') }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Source : disdex.io. Utile pour vérifier si une invitation est encore vivante.',
      handler: async (input, _ctx) => {
        const { invite } = input as { invite: string };
        const code = invite.replace(/https?:\/\/discord\.gg\//i, '').trim();
        const data = await safeFetchJson<{ status?: string; server?: { name?: string; url?: string }; server_invites?: Array<{ code: string; alive: boolean }> }>(
          `https://disdex.io/api/v1/invites/${encodeURIComponent(code)}`,
        );
        const alternatives = (data?.server_invites ?? [])
          .filter((entry) => entry.alive)
          .map((entry) => entry.code)
          .slice(0, 3);
        return {
          ok: true,
          summary: `Invitation « ${code} » : ${data?.status ?? 'inconnue'}${data?.server ? ` → ${data.server.name}` : ''}${alternatives.length > 0 ? `. Alternatives vivantes : ${alternatives.join(', ')}` : ''} (source : disdex.io).`,
        };
      },
    },
    {
      name: 'discordUserLookup',
      description: 'Infos publiques sur un utilisateur/bot indexé par disdex (serveurs vus, invitations créées).',
      category: 'web',
      paramsSchema: z.object({ userId: z.string().regex(/^\d{15,21}$/u, 'Identifiant Discord : 15 à 21 chiffres') }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Source : disdex.io. Données publiques d\u0027index, pas un profil privé.',
      handler: async (input, _ctx) => {
        const { userId } = input as { userId: string };
        // L'identifiant part tel quel dans le chemin : le schéma n'accepte que des chiffres.
        const data = await safeFetchJson<{
          username?: string;
          global_name?: string;
          is_bot?: boolean;
          server_count?: number;
          invite_count?: number;
        }>(`https://disdex.io/api/v1/users/${userId}`);
        if (!data?.username) return { ok: false, summary: 'Utilisateur non indexé sur disdex.' };
        return {
          ok: true,
          summary: `${data.global_name ?? data.username} (${data.is_bot ? 'bot' : 'utilisateur'}) : vu sur ${data.server_count ?? 0} serveur(s), ${data.invite_count ?? 0} invitation(s) créée(s) (source : disdex.io).`,
        };
      },
    },
  ];
}
