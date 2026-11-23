import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { botPermissionPolicy } from '../../../core/security/bot-permission.policy';
import type { DiscordToolContext } from './tool-context';

/** Tools sur les messages : purge bornée, envoi, suppression, lecture, étape de montage. */
export function messageTools(toolCtx: DiscordToolContext): BotTool[] {
  const { guildOf, noGuild, textChannelOf } = toolCtx;
  return [
    {
      name: 'purgeMessages',
      description:
        "Supprime en masse les messages récents d'un salon. Filtre obligatoire par âge (days) pour ne JAMAIS toucher les vieux messages : days=1 = aujourd'hui/hier uniquement, days=14 maximum (limite Discord du bulk delete). Les messages plus vieux que la fenêtre sont comptés et laissés en place.",
      category: 'agent',
      paramsSchema: z.object({
        channelId: z.string().min(1).optional(),
        count: z.number().int().min(1).max(1000).default(100),
        days: z
          .number()
          .int()
          .min(1)
          .max(14)
          .default(1)
          .describe("Fenêtre d'âge : ne supprime que les messages de moins de N jours (1 = aujourd'hui). Discord interdit le bulk delete au-delà de 14 jours."),
        onlyWithAttachments: z.boolean().default(false).optional().describe('Ne cibler que les messages avec pièces jointes/images'),
        onlyWithLinks: z.boolean().default(false).optional().describe('Ne cibler que les messages contenant un lien http(s)'),
      }),
      requiredModules: [],
      permissions: ['ManageMessages'],
      destructive: true,
      systemPrompt:
        'DESTRUCTIF mais borné : le filtre days protège les vieux messages, demande la fenêtre si l\u0027utilisateur ne la précise pas (« tout le salon » = days à demander quand même). Jamais de purge sans fenêtre d\u0027âge.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, count, days, onlyWithAttachments, onlyWithLinks } = input as {
          channelId?: string;
          count?: number;
          days?: number;
          onlyWithAttachments?: boolean;
          onlyWithLinks?: boolean;
        };
        const targetId = channelId || ctx.channelId || '';
        const channel = await guild.channels.fetch(targetId).catch(() => null);
        if (!channel || !channel.isTextBased()) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
        if (!botPermissionPolicy.canInGuild(guild, 'ManageMessages')) {
          return { ok: false, summary: botPermissionPolicy.refusal('ManageMessages') };
        }
        const budget = count ?? 100;
        const windowMs = (days ?? 1) * 86_400_000;
        const cutoff = Date.now() - windowMs;
        let deleted = 0;
        let skippedOld = 0;
        for (let round = 0; round < 10 && deleted < budget; round++) {
          const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
          if (!batch || batch.size === 0) break;
          // Filtrage STRICT par âge AVANT le bulkDelete : Discord refuse le
          // bulk au-delà de 14 jours, et l'utilisateur demande une fenêtre
          // précise (« aujourd'hui »), jamais toucher les vieux messages.
          // Filtres optionnels de CONTENU : pièces jointes / liens.
          const inWindowAll = batch.filter(
            (message) =>
              message.createdTimestamp >= cutoff &&
              !message.pinned &&
              (!onlyWithAttachments || message.attachments.size > 0) &&
              (!onlyWithLinks || /https?:\/\//iu.test(message.content)),
          );
          const tooOld = batch.filter((message) => message.createdTimestamp < cutoff);
          skippedOld += tooOld.size;
          if (inWindowAll.size === 0) break;
          // Le budget count est respecté PAR LOT (l'ancien code pouvait
          // supprimer jusqu'à 100 messages pour un count=5).
          const inWindow = inWindowAll.first(budget - deleted);
          const done = await channel.bulkDelete(inWindow, true).catch(() => null);
          if (!done || done.size === 0) break;
          deleted += done.size;
        }
        const note = skippedOld > 0 ? ` ${skippedOld} message(s) plus vieux que ${days ?? 1}j laissés en place.` : '';
        return { ok: true, summary: `🧹 ${deleted} message(s) supprimé(s) dans <#${channel.id}> (fenêtre ${days ?? 1}j).${note}` };
      },
    },
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
      systemPrompt: 'DESTRUCTIF irréversible : confirme avec l\u2019utilisateur avant d\u2019appeler.',
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
