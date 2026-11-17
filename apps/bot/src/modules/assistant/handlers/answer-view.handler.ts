import { Button, ButtonHandler } from '@spraxium/components';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { Logger } from '@spraxium/logger';

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

const log = new Logger('AnswerView');

/** Clic sur le portail : DEFER immédiat (fenêtre 3s), puis panneau V2 en éphémère. */
@ButtonHandler(AnswerViewButton)
export class AnswerViewHandler {
  constructor(private readonly v2: import('@spraxium/components').V2Service) {}

  async handle(interaction: ButtonInteraction): Promise<void> {
    const dispatchDelay = Date.now() - interaction.createdTimestamp;
    if (dispatchDelay > 1500) log.warn(`dispatch tardif de ${dispatchDelay}ms sur answer:view`);
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const answer = getAnswer(interaction.message.id);
    if (!answer) {
      await interaction.editReply({ content: 'Panneau expiré : mentionne-moi à nouveau.' }).catch(() => {});
      return;
    }
    if (answer.ownerId && interaction.user.id !== answer.ownerId) {
      await interaction
        .editReply({ content: 'Ce panneau est réservé à la personne qui a fait la demande.' })
        .catch(() => {});
      return;
    }
    await interaction
      .editReply({
        components: answer.components as never,
        flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as never,
      })
      .catch(() => {});
    if (answer.tools) {
      // Réattache l'état de pagination au VRAI id du message éphémère.
      const ephemeralMessage = await interaction.fetchReply();
      store.set(ephemeralMessage.id, { components: answer.components, tools: answer.tools, storedAt: Date.now() });
    }
  }
}
