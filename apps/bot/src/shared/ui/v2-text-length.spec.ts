import { describe, expect, it } from 'vitest';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { panel } from './index';
import { v2TextLength } from './v2-text-length';

/**
 * Longueur du texte d'un message Components V2, comme Discord le compte
 * avant de le refuser au-delà de 4 000 caractères.
 */

describe('v2TextLength', () => {
  it('les textes s\u0027additionnent, imbriqués compris ; séparateurs et drapeaux ne comptent pas', () => {
    const payload = {
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: 17,
          components: [
            { type: 14 },
            { type: 10, content: '12345' },
            { type: 1, components: [{ type: 2, label: 'ab', custom_id: 'x' }] },
          ],
        },
      ],
    };
    expect(v2TextLength(payload)).toBe(7);
  });

  it('les builders se lisent par leur forme JSON : titres, lignes, pied et libellés des boutons', () => {
    const container = panel({ title: '## Titre', lines: ['ligne une', 'ligne deux'], footer: 'pied' });
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('plan:apply').setLabel('Appliquer').setStyle(ButtonStyle.Success)),
    );
    const payload = { flags: MessageFlags.IsComponentsV2, components: [container] };
    // Titre, deux lignes, pied (préfixe de sous-texte compris), libellé du bouton : 8 + 9 + 10 + 7 + 9.
    expect(v2TextLength(payload)).toBe(43);
  });

  it('sans composants, zéro', () => {
    expect(v2TextLength({})).toBe(0);
    expect(v2TextLength({ components: [] })).toBe(0);
    expect(v2TextLength({ components: [new TextDisplayBuilder().setContent('abc')] })).toBe(3);
  });
});
