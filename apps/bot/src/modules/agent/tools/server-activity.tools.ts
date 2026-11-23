import type { Guild, NewsChannel, TextChannel } from 'discord.js';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import type { DiscordToolContext } from './tool-context';
import { agentReason } from './tool-context';

/** Tools d'observation du serveur : activité des salons, journal d'audit, webhooks. */
export function serverActivityTools(toolCtx: DiscordToolContext): BotTool[] {
  const { guildOf, noGuild, textChannelOf } = toolCtx;
  return [
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
        'Utile AVANT tout archivage : la colonne jours dit précisément quels salons dépassent le seuil. Ensuite déplace avec moveChannel vers la catégorie archive (ou crée-la d\u0027abord). Ne devine jamais l\u0027inactivité « à l\u0027œil » : cet outil donne les dates exactes.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { sinceDays, categoryId } = input as { sinceDays?: number; categoryId?: string };
        const threshold = sinceDays ?? 15;
        const results = await analyzeChannelActivity(guild, categoryId, (done, total) => ctx.progress?.(`analyse : ${done}/${total} salons`));
        if (results.length === 0) return { ok: false, summary: 'Aucun salon texte à analyser.' };

        await ctx.progress?.('analyse terminée');
        const dead = results.filter((r) => r.days === null || r.days >= threshold);
        const alive = results.length - dead.length;
        const deadLines = dead
          .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999))
          .slice(0, 25)
          .map((r) => `#${r.name} → ${r.days === null ? 'jamais de message membre' : `${r.days}j`}`);
        return {
          ok: true,
          summary:
            `${results.length} salon(s) analysé(s), seuil ${threshold}j : ${dead.length} inactif(s), ${alive} vivant(s). ` +
            `Inactifs : ${deadLines.join(' | ') || 'aucun'}. Déplace-les avec moveChannel (categoryName/ID cible).`,
          data: { threshold, scanned: results.length, deadIds: dead.map((r) => r.id) },
        };
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
        const webhook = await (channel as unknown as { createWebhook: (o: object) => Promise<{ id: string; name: string }> }).createWebhook({ name, reason: agentReason(ctx) });
        return { ok: true, summary: `Webhook **${webhook.name}** créé dans <#${channel.id}>.`, data: { webhookId: webhook.id } };
      },
    },
  ];
}

/** Taille d'un lot de salons analysés en parallèle. */
const ACTIVITY_BATCH_SIZE = 8;

/** Lit les 25 derniers messages : âge en jours du dernier message d'un vrai membre (null si aucun). */
async function lastHumanMessageDays(channel: TextChannel | NewsChannel, now: number): Promise<number | null> {
  const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!messages) return null;
  for (const message of messages.values()) {
    // Un vrai membre : ni bot ni webhook (les tests E2E passent par webhooks).
    if (message.author.bot || message.webhookId) continue;
    return Math.floor((now - message.createdTimestamp) / 86_400_000);
  }
  return null;
}

/**
 * Analyse parallélisée par LOTS de 8 (l'audit mesurait 1-2 min en séquentiel
 * sur les grosses guildes). `onProgress` est appelé à chaque lot, dans LA
 * ligne de statut du traitement (jamais de messages dédiés).
 */
async function analyzeChannelActivity(
  guild: Guild,
  categoryId: string | undefined,
  onProgress: (done: number, total: number) => Promise<void> | void,
): Promise<Array<{ name: string; id: string; days: number | null }>> {
  // Tout salon textuel : salons texte, annonces, fils (comme à l'origine).
  const channels = [...guild.channels.cache.values()].filter(
    (channel): channel is TextChannel | NewsChannel => channel.isTextBased() && (!categoryId || channel.parentId === categoryId),
  );
  const now = Date.now();
  const results: Array<{ name: string; id: string; days: number | null }> = [];
  for (let i = 0; i < channels.length; i += ACTIVITY_BATCH_SIZE) {
    const batch = channels.slice(i, i + ACTIVITY_BATCH_SIZE);
    const scanned = await Promise.all(
      batch.map(async (channel) => ({ name: channel.name, id: channel.id, days: await lastHumanMessageDays(channel, now) })),
    );
    results.push(...scanned);
    await onProgress(results.length, channels.length);
  }
  return results;
}
