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
import type {
  InteractionBinding,
  SurfaceDefinition,
} from '@10cordes/shared';
import type { ButtonService } from '@spraxium/components';

/**
 * Renderer V2 d'une InteractiveSurface : definition + state → container
 * Components V2 déterministe. Le re-render après mutation d'état reproduit
 * EXACTEMENT le même message (les labels/styles patchés via updateComponent
 * écrasent la définition en DB avant re-rendu : une seule source de vérité).
 *
 * Boutons : inline dynamiques (customId réel `surface:act~b=<key>`, contrainte
 * Spraxium baseId exact + <100 chars). Menus : `surface:select~s=<row>`.
 */

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

  /** Rendu complet du container ( garde 10 000 octets via validateSurfaceDefinition amont). */
  async render(definition: SurfaceDefinition): Promise<ContainerBuilder> {
    const container = new ContainerBuilder().setAccentColor(definition.accentColor ?? 0xd9_59_26);
    if (definition.thumbnailUrl) {
      const section = new SectionBuilder().setThumbnailAccessory(new ThumbnailBuilder().setURL(definition.thumbnailUrl));
      section.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${definition.title ?? ''}`));
      if (definition.description) {
        section.addTextDisplayComponents(new TextDisplayBuilder().setContent(definition.description));
      }
      container.addSectionComponents(section);
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${definition.title ?? ''}`));
      if (definition.description) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(definition.description));
      }
    }
    if (definition.imageUrl) {
      const gallery = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setDescription('Image de la surface').setURL(definition.imageUrl),
      );
      container.addMediaGalleryComponents(gallery);
    }
    if (definition.footer) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${definition.footer}`));
    }
    for (const [rowIndex, row] of definition.rows.entries()) {
      if (row.kind === 'buttons') {
        // Actifs → boutons dynamiques inline (customId surface:act~b=key).
        // Désactivés → bouton STATIQUE disabled (aucune interaction possible,
        // le customId factice surface:off n'a aucun handler).
        const activeItems = row.buttons
          .filter((binding) => !binding.disabled)
          .map((binding) => ({ b: binding.key, label: binding.label, style: binding.style, emoji: binding.emoji }));
        const built = await this.buttons.buildDynamicButtons(SurfaceActionButton, activeItems);
        let cursor = 0;
        const builders: ButtonBuilder[] = [];
        for (const binding of row.buttons) {
          if (binding.disabled) {
            const disabled = new ButtonBuilder()
              .setLabel(binding.label.slice(0, 80))
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
        void rowIndex;
      } else {
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`surface:select~s=${rowIndex}`)
          .setPlaceholder(row.select.placeholder.slice(0, 100))
          .setMinValues(row.select.options[0]?.minValues ?? 1)
          .setMaxValues(row.select.options[0]?.maxValues ?? 1);
        for (const option of row.select.options) {
          menu.addOptions({
            label: option.label.slice(0, 100),
            value: option.key,
            description: option.description?.slice(0, 100),
          });
        }
        container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
      }
    }
    return container;
  }
}
