import type { GuildMember } from 'discord.js';
import type { ModalSpec } from '@10cordes/shared';

/** Variables d'exécution d'un pipeline d'une surface. */
export interface PipelineVars {
  guildId: string;
  channelId: string;
  actorId: string;
  actorName: string;
  surfaceId: string;
  messageId: string | null;
  state: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  values: Record<string, string | number | boolean | null>;
  modalValues?: Record<string, string>;
  selectedValues?: string[];
  event?: Record<string, unknown>;
}

export type ToolRunner = (name: string, input: unknown) => Promise<{ ok: boolean; summary: string; data?: Record<string, unknown> }>;

export interface PipelineContext {
  vars: PipelineVars;
  runTool: ToolRunner;
  member: GuildMember | null;
}

export interface PipelineResult {
  ok: boolean;
  replyEphemeral: string | null;
  openModal: ModalSpec | null;
  error: string | null;
  stateChanged: boolean;
  definitionChanged: boolean;
}
