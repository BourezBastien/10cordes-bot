import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';
import { DynamicButton } from '@spraxium/components';
import type { ButtonService } from '@spraxium/components';
import type { InteractionBinding, SurfaceDefinition } from '@10cordes/shared';
import { PipelineInterpolator } from './pipeline-interpolation';
import type { PipelineVars } from './pipeline.types';

/**
 * Renderer V2 d'une InteractiveSurface : definition + state → container
 * Components V2 déterministe. Le re-render après mutation d'état reproduit
 * EXACTEMENT le même message (les labels/styles patchés via updateComponent
 * écrasent la définition en DB avant re-rendu : une seule source de vérité).
 *
 * Les textes (titre, description, footer, labels) affichent l'état EN DIRECT :
 * `{{state.chemin}}` y est interpolé à chaque rendu. Sans cela, un panneau de
 * jeu montrait ses variables en clair et les clics semblaient sans effet.
 *
 * Boutons : inline dynamiques (customId réel `surface:act~b=<key>`, contrainte
 * Spraxium baseId exact + <100 chars). Menus : `surface:select~s=<row>`.
 */

const interpolator = new PipelineInterpolator();

/** Bornes des textes interpolés : les 4 000 caractères d'un message V2 se partagent entre ses textes. */
const TITLE_MAX = 300;
const DESCRIPTION_MAX = 3000;
const FOOTER_MAX = 200;

/** Variables de rendu : hors interaction, seules les références à l'état ont une valeur. */
function renderVars(state: Record<string, unknown>): PipelineVars {
  return { guildId: '', channelId: '', actorId: '', actorName: '', surfaceId: '', messageId: null, state, steps: [], values: {} };
}

/** Texte d'affichage avec l'état interpolé, borné à la limite de son composant. */
export function renderSurfaceText(text: string | undefined, state: Record<string, unknown>, max: number): string {
  if (!text) return '';
  return interpolator.interpolate(text, renderVars(state)).slice(0, max);
}

const STYLE_MAP: Record<InteractionBinding['style'], ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

/** Composant dynamique des boutons de surface (params inline k=b). */
@DynamicButton({ baseId: 'surface:act', encoding: 'inline' })
export class SurfaceActionButton {
  static render(item: { b: string; label: string; style: string; emoji?: string }) {
    return {
      label: item.label.slice(0, 80),
      style: (item.style as 'primary' | 'secondary' | 'success' | 'danger') ?? 'primary',
      emoji: item.emoji ? { name: item.emoji } : undefined,
      params: { b: item.b },
    };
  }
}

export class SurfaceRenderer {
  constructor(private readonly buttons: ButtonService) {}

  /** Rendu complet du container, avec l'état interpolé dans chaque texte. */
  async render(definition: SurfaceDefinition, state: Record<string, unknown> = {}): Promise<ContainerBuilder> {
    const container = new ContainerBuilder().setAccentColor(definition.accentColor ?? 0xd9_59_26);
    const title = renderSurfaceText(definition.title, state, TITLE_MAX);
    const description = renderSurfaceText(definition.description, state, DESCRIPTION_MAX);
    if (definition.thumbnailUrl) {
      const section = new SectionBuilder().setThumbnailAccessory(new ThumbnailBuilder().setURL(definition.thumbnailUrl));
      section.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
      if (description) {
        section.addTextDisplayComponents(new TextDisplayBuilder().setContent(description));
      }
      container.addSectionComponents(section);
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
      if (description) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(description));
      }
    }
    if (definition.imageUrl) {
      const gallery = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setDescription('Image de la surface').setURL(definition.imageUrl),
      );
      container.addMediaGalleryComponents(gallery);
    }
    const footer = renderSurfaceText(definition.footer, state, FOOTER_MAX);
    if (footer) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));
    }
    for (const [rowIndex, row] of definition.rows.entries()) {
      if (row.kind === 'buttons') {
        // Actifs → boutons dynamiques inline (customId surface:act~b=key).
        // Désactivés → bouton STATIQUE disabled (aucune interaction possible,
        // le customId factice surface:off n'a aucun handler).
        const labelOf = (binding: InteractionBinding): string => renderSurfaceText(binding.label, state, 80) || binding.key;
        const activeItems = row.buttons
          .filter((binding) => !binding.disabled)
          .map((binding) => ({ b: binding.key, label: labelOf(binding), style: binding.style, emoji: binding.emoji }));
        const built = await this.buttons.buildDynamicButtons(SurfaceActionButton, activeItems);
        let cursor = 0;
        const builders: ButtonBuilder[] = [];
        for (const binding of row.buttons) {
          if (binding.disabled) {
            const disabled = new ButtonBuilder()
              .setLabel(labelOf(binding))
              .setStyle(STYLE_MAP[binding.style])
              .setCustomId(`surface:off~b=${binding.key}`)
              .setDisabled(true);
            if (binding.emoji) disabled.setEmoji(binding.emoji);
            builders.push(disabled);
          } else {
            const dynamic = built[cursor];
            cursor += 1;
            if (dynamic) builders.push(dynamic);
          }
        }
        container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(...builders));
      } else {
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`surface:select~s=${rowIndex}`)
          .setPlaceholder(renderSurfaceText(row.select.placeholder, state, 100) || 'Choisis une option')
          .setMinValues(row.select.options[0]?.minValues ?? 1)
          .setMaxValues(row.select.options[0]?.maxValues ?? 1);
        for (const option of row.select.options) {
          menu.addOptions({
            label: renderSurfaceText(option.label, state, 100) || option.key,
            value: option.key,
            description: option.description ? renderSurfaceText(option.description, state, 100) : undefined,
          });
        }
        container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
      }
    }
    return container;
  }
}
