import type { Message } from 'discord.js';

/**
 * Snapshot sérialisable d'une demande utilisateur. Un job de queue porte ce
 * snapshot (jamais l'objet Message live) : un job qui survit à un restart est
 * retraitable — les objets live sont résolus au moment du traitement.
 */
export interface AgentRequest {
  guildId: string;
  channelId: string;
  userId: string;
  authorName: string;
  content: string;
  messageId: string;
  /** Vrai si le message répond à un message du bot (continuité de conversation). */
  repliesToBot: boolean;
  /** Timestamp du message source (ms) — sert au coalescing des demandes rapprochées. */
  createdAtMs?: number;
}

export type AgentJobData = { request: AgentRequest };

export type QueueCounts = {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
};

export const QUEUE_NAME = 'agent';
export const AGENT_CONCURRENCY = 5;
export const JOB_ATTEMPTS = 3;

export function snapshotFromMessage(message: Message, repliesToBot: boolean): AgentRequest {
  return {
    guildId: message.guildId!,
    channelId: message.channelId,
    userId: message.author.id,
    authorName: message.member?.displayName ?? message.author.globalName ?? message.author.username,
    content: message.content,
    messageId: message.id,
    repliesToBot,
    createdAtMs: message.createdTimestamp,
  };
}
