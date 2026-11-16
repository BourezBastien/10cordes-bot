import { Button, ButtonHandler } from '@spraxium/components';
import { MessageFlags, type ButtonInteraction } from 'discord.js';

export const ANSWER_VIEW_ID = 'answer:view';

export interface StoredAnswer {
  /** Composants du payload (containers V2, JSON-sérialisables). */
  components: unknown[];
  /** Pour tools.list : état de pagination à réattacher au message éphémère. */
  tools?: {
    tools: Array<{ name: string; description: string; category: string }>;
    page: number;
    intro: string;
  };
  /** Si défini : seule cette personne peut ouvrir le panneau (plans de l'agent). */
  ownerId?: string;
}

interface StoredEntry extends StoredAnswer {
  storedAt: number;
}

/** Réponses prêtes, indexées par l'id du message-portail (borné + TTL 10 min). */
const store = new Map<string, StoredEntry>();
const MAX_STORED = 50;
const STORE_TTL_MS = 10 * 60_000;

export function storeAnswer(messageId: string, answer: StoredAnswer): void {
  if (store.size >= MAX_STORED) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  store.set(messageId, { ...answer, storedAt: Date.now() });
}

export function deleteAnswer(messageId: string): void {
  store.delete(messageId);
}

export function getAnswer(messageId: string): StoredAnswer | undefined {
  const entry = store.get(messageId);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > STORE_TTL_MS) {
    store.delete(messageId);
    return undefined;
  }
  return entry;
}

@Button({ customId: ANSWER_VIEW_ID, label: 'Afficher la réponse', style: 'primary' })
export class AnswerViewButton {}

/** Clic sur le portail : répond en ÉPHÉMÈRE avec le panneau V2 complet. */
@ButtonHandler(AnswerViewButton)
export class AnswerViewHandler {
  constructor(private readonly v2: import('@spraxium/components').V2Service) {}

  async handle(interaction: ButtonInteraction): Promise<void> {
    const answer = getAnswer(interaction.message.id);
    if (!answer) {
      void interaction
        .reply({ content: 'Panneau expiré : mentionne-moi à nouveau.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }
    if (answer.ownerId && interaction.user.id !== answer.ownerId) {
      void interaction
        .reply({
          content: 'Ce panneau est réservé à la personne qui a fait la demande.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }
    await interaction.reply({
      components: answer.components as never,
      flags: (MessageFlags.Ephemeral | MessageFlags.IsComponentsV2) as never,
    });
    if (answer.tools) {
      // Réattache l'état de pagination au VRAI id du message éphémère.
      const ephemeralMessage = await interaction.fetchReply();
      store.set(ephemeralMessage.id, { components: answer.components, tools: answer.tools, storedAt: Date.now() });
    }
  }
}
