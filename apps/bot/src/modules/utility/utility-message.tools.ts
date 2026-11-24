import { ChannelType } from 'discord.js';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { toolRequesterContext } from '../../core/security/access-policy';
import { massMentionPolicy } from '../../core/security/mass-mention.policy';
import type { UtilityToolsDeps } from './utility-resolver';

/**
 * Tools d'action sur les messages : épinglage et désépinglage, annonce par
 * webhook, publication (crosspost) d'un message d'annonces, réaction.
 */

/** Dit au demandeur pourquoi sa mention de masse n'a pingué personne. */
const MASS_MENTION_NOTE = 'mentions @everyone et @here neutralisées : elles ne pinguent que pour le propriétaire du serveur et les administrateurs';

/** Tool message.pin : épingle un message dans un salon. */
export function messagePinTool(deps: UtilityToolsDeps): BotTool {
  const { resolver } = deps;
  return {
    name: 'message.pin',
    description: 'Épingle un message dans un salon.',
    category: 'utility',
    paramsSchema: z.object({ channelId: z.string().min(1), messageId: z.string().min(1) }),
    requiredModules: [],
    permissions: ['ManageMessages'],
    destructive: false,
    systemPrompt: 'Épinglage simple.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const channel = resolver.textChannel(ctx.guildId, (input as { channelId: string }).channelId);
      if (!channel) return { ok: false, summary: 'Salon introuvable.' };
      const pinned = await channel.messages.pin((input as { messageId: string }).messageId).then(() => true).catch(() => false);
      return pinned
        ? { ok: true, summary: 'Message épinglé.' }
        : { ok: false, summary: 'Épinglage impossible (message introuvable ou permissions ?).' };
    },
  };
}

/** Tool message.unpin : désépingle un message. */
export function messageUnpinTool(deps: UtilityToolsDeps): BotTool {
  const { resolver } = deps;
  return {
    name: 'message.unpin',
    description: 'Désépingle un message.',
    category: 'utility',
    paramsSchema: z.object({ channelId: z.string().min(1), messageId: z.string().min(1) }),
    requiredModules: [],
    permissions: ['ManageMessages'],
    destructive: false,
    systemPrompt: 'Désépinglage simple.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const channel = resolver.textChannel(ctx.guildId, (input as { channelId: string }).channelId);
      if (!channel) return { ok: false, summary: 'Salon introuvable.' };
      const unpinned = await channel.messages.unpin((input as { messageId: string }).messageId).then(() => true).catch(() => false);
      return unpinned
        ? { ok: true, summary: 'Message désépinglé.' }
        : { ok: false, summary: 'Désépinglage impossible (message introuvable ou permissions ?).' };
    },
  };
}

/** Tool webhook.post : poste une annonce via webhook dans un salon (nom et avatar personnalisés). */
export function webhookPostTool(deps: UtilityToolsDeps): BotTool {
  const { resolver } = deps;
  return {
    name: 'webhook.post',
    description: 'Poste une annonce via webhook dans un salon (nom + avatar personnalisés). Réservé aux annonces officielles.',
    category: 'utility',
    paramsSchema: z.object({
      channelId: z.string().min(1),
      name: z.string().min(1).max(80),
      content: z.string().min(1).max(1500),
      avatarUrl: z.string().url().max(500).optional(),
    }),
    requiredModules: [],
    permissions: ['ManageWebhooks'],
    destructive: false,
    systemPrompt:
      'Uniquement pour des annonces de staff explicites. JAMAIS d\u0027impersonation d\u0027un vrai membre (confusion de confiance).',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const channel = resolver.textChannel(ctx.guildId, (input as { channelId: string }).channelId);
      if (!channel || channel.isThread()) return { ok: false, summary: 'Salon introuvable.' };
      const { name, content, avatarUrl } = input as { name: string; content: string; avatarUrl?: string };
      const hooks = await channel.fetchWebhooks().catch(() => null);
      const existing = hooks ? [...hooks.values()].find((h) => h.name === 'agent-annonces' && h.channelId === channel.id) : undefined;
      let hook = existing;
      if (!hook) {
        hook = await channel.createWebhook({ name: 'agent-annonces', avatar: avatarUrl, reason: 'annonces agent' }).catch(() => undefined);
      }
      if (!hook) return { ok: false, summary: 'Création du webhook impossible (permissions ManageWebhooks ?).' };
      // Une annonce ne fait pas pinguer tout le serveur pour qui ne le pourrait pas lui-même.
      const safe = massMentionPolicy.guard(content.slice(0, 1500), toolRequesterContext(ctx, resolver.guildOf(ctx)));
      const sent = await hook.send({ content: safe, username: name.slice(0, 80), avatarURL: avatarUrl }).then(() => true).catch(() => false);
      return sent
        ? { ok: true, summary: `Annonce postée via webhook${safe === content.slice(0, 1500) ? '' : ` (${MASS_MENTION_NOTE})`}.` }
        : { ok: false, summary: "Envoi via webhook échoué (permissions du salon, contenu rejeté ?)." };
    },
  };
}

/** Tool message.crosspost : publie un message d'annonces vers les serveurs qui le suivent. */
export function messageCrosspostTool(deps: UtilityToolsDeps): BotTool {
  const { resolver } = deps;
  return {
    name: 'message.crosspost',
    description: 'Crosspost (publie) un message d\u2019un salon d\u2019annonces vers tous les serveurs qui le suivent.',
    category: 'utility',
    paramsSchema: z.object({ channelId: z.string().min(1), messageId: z.string().min(1) }),
    requiredModules: [],
    permissions: ['ManageMessages'],
    destructive: false,
    systemPrompt: 'Fonctionne uniquement dans un salon de type ANNONCES (NewsChannel). Sinon Discord refuse.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { channelId, messageId } = input as { channelId: string; messageId: string };
      const channel = resolver.textChannel(ctx.guildId, channelId);
      if (!channel || channel.type !== ChannelType.GuildAnnouncement) {
        return { ok: false, summary: 'Le crosspost exige un salon de type Annonces.' };
      }
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) return { ok: false, summary: 'Message introuvable.' };
      const crossposted = await message.crosspost().then(() => true).catch(() => false);
      return crossposted
        ? { ok: true, summary: 'Message publié (crosspost) vers les serveurs abonnés.' }
        : { ok: false, summary: 'Crosspost refusé (déjà publié ou rate-limit).' };
    },
  };
}

/** Tool reaction.add : ajoute une réaction emoji à un message. */
export function reactionAddTool(deps: UtilityToolsDeps): BotTool {
  const { resolver } = deps;
  return {
    name: 'reaction.add',
    description: 'Ajoute une réaction emoji à un message.',
    category: 'utility',
    paramsSchema: z.object({ channelId: z.string().min(1), messageId: z.string().min(1), emoji: z.string().min(1).max(32) }),
    requiredModules: [],
    permissions: ['AddReactions'],
    destructive: false,
    systemPrompt: 'Emoji en format unicode ou <:nom:id>.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const channel = resolver.textChannel(ctx.guildId, (input as { channelId: string }).channelId);
      if (!channel) return { ok: false, summary: 'Salon introuvable.' };
      const { messageId, emoji } = input as { messageId: string; emoji: string };
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) return { ok: false, summary: 'Message introuvable.' };
      const reacted = await message.react(emoji).then(() => true).catch(() => false);
      return reacted
        ? { ok: true, summary: `Réaction ${emoji} ajoutée.` }
        : { ok: false, summary: `Réaction ${emoji} impossible (emoji invalide ou permissions ?).` };
    },
  };
}
