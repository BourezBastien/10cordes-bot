import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';
import { DESTRUCTIVE_OP_TYPES, opLabel, type AdminOp } from '@10cordes/shared';
import { AGENT_APPROVE_ID, AGENT_CANCEL_ID } from './components/agent.buttons';

export interface PlanPanelInput {
  title: string;
  ops: AdminOp[];
  requesterId: string;
  expiresAt: Date;
  destructive: boolean;
}

export interface PlanReply {
  flags: number;
  components: [ContainerBuilder, ActionRowBuilder<ButtonBuilder>];
}

/**
 * Panneau de proposition d'un plan : liste des ops (via opLabel), cadre rouge
 * si destructif, boutons Approuver / Annuler — sans confirmation, le plan expire.
 */
export function buildPlanReply(input: PlanPanelInput): PlanReply {
  const container = new ContainerBuilder().setAccentColor(
    input.destructive ? 0xe8_8b_94 : 0x57_f2_87,
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🤖 Plan — ${input.title}`));

  const lines: string[] = [
    `**Demandeur** : <@${input.requesterId}>`,
    `**Expire** : <t:${Math.floor(input.expiresAt.getTime() / 1000)}:R> (sans confirmation, le plan est annulé)`,
    '',
    ...input.ops.map((op: AdminOp) => (DESTRUCTIVE_OP_TYPES.has(op.type) ? `🔴 ${opLabel(op)}` : `🟢 ${opLabel(op)}`)),
  ];
  if (input.destructive) {
    lines.push('', '⛔ **Plan destructif** — approbation réservée au owner et à la whitelist.');
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(AGENT_APPROVE_ID).setLabel('✅ Approuver').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(AGENT_CANCEL_ID).setLabel('✖ Annuler').setStyle(ButtonStyle.Secondary),
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container, row],
  };
}
