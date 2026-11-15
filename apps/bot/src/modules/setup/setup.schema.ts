import { SlashCommand } from '@spraxium/common';
import { PermissionFlagsBits } from 'discord.js';

/**
 * Commande racine UNIQUE du panneau de contrôle — ouvre le dashboard V2
 * par catégories (voir setup.panel.ts). /help et /lang complètent l'offre.
 */
@SlashCommand({
  name: 'setup',
  description: 'Panneau de contrôle : modules, bienvenue, logs, tickets, rôles, levels, modération, config, IA.',
  defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  dmPermission: false,
})
export class SetupCommand {}
