import { MessageFlags, type MessageCreateOptions } from 'discord.js';
import type { LogCategory } from '@10cordes/shared';
import { panel } from '../../../shared/ui';

/** Contenu d'une entrée de journal, fourni par l'émetteur (listener de modération, vocal...). */
export interface LogEntry {
  title: string;
  lines: string[];
  accentColor?: number;
}

/**
 * Panneau V2 d'une entrée de journal. POO pure : données en, payload Discord
 * complet en (drapeau IsComponentsV2 compris), zéro effet de bord.
 */
export class LogEntryPresenter {
  render(entry: LogEntry, category: LogCategory): MessageCreateOptions {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [panel({ ...entry, footer: `catégorie : ${category}` })],
    };
  }
}
