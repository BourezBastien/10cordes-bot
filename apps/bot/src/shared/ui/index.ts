import {
  ContainerBuilder,
  FileBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';

/**
 * Helpers de rendu : Components V2 est le rendu de base de tous les messages du bot
 * (flag `IsComponentsV2`). Nommage naturel, sans suffixe technique.
 */

export function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

export function separator(): SeparatorBuilder {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

export interface PanelOptions {
  /** Titre markdown du panneau (ex: "## 🧩 Modules"). */
  title: string;
  /** Lignes markdown du corps : une entrée TextDisplay par ligne. */
  lines: string[];
  /** Couleur d'accent du container. */
  accentColor?: number;
  /** Ligne de pied (notes, hints). */
  footer?: string;
}

/** Panneau générique : titre + corps + footer dans un container à bordure. */
export function panel(options: PanelOptions): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(options.accentColor ?? 0x58_65_f2);
  container.addTextDisplayComponents(text(options.title));
  container.addSeparatorComponents(separator());
  if (options.lines.length > 0) {
    container.addTextDisplayComponents(...options.lines.map(text));
  }
  if (options.footer) {
    container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(text(`-# ${options.footer}`));
  }
  return container;
}

/**
 * Notification courte en Components V2 (texte seul). Utilisée pour les
 * confirmations, avertissements et erreurs — jamais de `content` brut.
 */
export function notice(
  content: string,
  ephemeral = false,
): { flags: number; components: TextDisplayBuilder[] } {
  return {
    flags: ephemeral ? MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 : MessageFlags.IsComponentsV2,
    components: [new TextDisplayBuilder().setContent(content)],
  };
}
