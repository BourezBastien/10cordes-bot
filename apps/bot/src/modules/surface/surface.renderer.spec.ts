import { describe, expect, it, vi } from 'vitest';
import { ButtonBuilder, ButtonStyle } from 'discord.js';
import type { SurfaceDefinition } from '@10cordes/shared';
import { renderSurfaceText, SurfaceRenderer } from './surface.renderer';

/**
 * Rendu d'une surface. L'état doit paraître dans les textes : sans cela un
 * panneau de jeu montrait `{{state.game.hand}}` en clair et les clics
 * semblaient sans effet.
 */

const STATE = { game: { hand: ['A♠', '7♦'], coins: 90 }, player: null };

describe('renderSurfaceText · état interpolé', () => {
  it('affiche une valeur, un tableau et un objet de l\u0027état', () => {
    expect(renderSurfaceText('Main : {{state.game.hand}}', STATE, 300)).toBe('Main : A♠, 7♦');
    expect(renderSurfaceText('Jetons : {{state.game.coins}}', STATE, 300)).toBe('Jetons : 90');
    expect(renderSurfaceText('Partie : {{state.game}}', STATE, 300)).toBe('Partie : {"hand":["A♠","7♦"],"coins":90}');
  });

  it('une référence inconnue ou nulle devient du vide, jamais « undefined »', () => {
    expect(renderSurfaceText('Joueur : {{state.game.dealer}}', STATE, 300)).toBe('Joueur : ');
    expect(renderSurfaceText('Joueur : {{state.player}}', STATE, 300)).toBe('Joueur : ');
    expect(renderSurfaceText('Absent : {{state.nulle.part}}', STATE, 300)).toBe('Absent : ');
  });

  it('est borné à la limite de son composant', () => {
    expect(renderSurfaceText('{{state.game.hand}}', STATE, 5)).toBe('Main : '.slice(0, 0) + 'A♠, 7');
  });

  it('rend une chaîne vide sans texte', () => {
    expect(renderSurfaceText(undefined, STATE, 10)).toBe('');
  });
});

describe('SurfaceRenderer.render · texte, pied et labels', () => {
  const definition: SurfaceDefinition = {
    title: 'Blackjack : table de Paul',
    description: '**Ta main :** {{state.game.hand}}\n**Jetons :** {{state.game.coins}}',
    footer: 'Tour de {{state.player}}',
    initialState: {},
    rows: [
      {
        kind: 'buttons',
        buttons: [
          { key: 'hit', label: 'Tirer ({{state.game.cards}})', style: 'primary', disabled: false, access: {}, pipeline: [{ type: 'replyEphemeral', content: 'ok' }] },
          { key: 'stand', label: 'Rester, {{state.game.coins}} jetons', style: 'secondary', disabled: true, access: {}, pipeline: [{ type: 'replyEphemeral', content: 'ok' }] },
        ],
      },
      {
        kind: 'select',
        select: {
          placeholder: 'Mise, {{state.game.coins}} jetons',
          options: [{ key: 'm10', label: 'Miser 10', style: 'primary', disabled: false, access: {}, description: 'Il te reste {{state.game.coins}}', pipeline: [{ type: 'replyEphemeral', content: 'ok' }] }],
        },
      },
    ],
  };

  function renderer() {
    const buildDynamicButtons = vi.fn(async (_component: unknown, items: Array<{ b: string; label: string }>) =>
      items.map((item) => new ButtonBuilder().setCustomId(`surface:act~b=${item.b}`).setLabel(item.label).setStyle(ButtonStyle.Primary)),
    );
    return { renderer: new SurfaceRenderer({ buildDynamicButtons } as never), buildDynamicButtons };
  }

  it('interpole l\u0027état dans le titre, la description, le pied, les labels et le menu', async () => {
    const { renderer: r } = renderer();
    const json = JSON.stringify((await r.render(definition, STATE)).toJSON());
    expect(json).toContain('Ta main :** A♠, 7♦');
    expect(json).toContain('Jetons :** 90');
    expect(json).toContain('Tour de ');
    expect(json).toContain('Rester, 90 jetons');
    expect(json).toContain('Mise, 90 jetons');
    expect(json).toContain('Il te reste 90');
    expect(json).not.toContain('{{');
  });

  it('le label d\u0027un bouton actif reçoit l\u0027état interpolé', async () => {
    const { renderer: r, buildDynamicButtons } = renderer();
    await r.render(definition, STATE);
    const items = buildDynamicButtons.mock.calls[0]?.[1] as Array<{ b: string; label: string }>;
    expect(items).toEqual([{ b: 'hit', label: 'Tirer ()', style: 'primary', emoji: undefined }]);
  });

  it('le même panneau rendu avec un autre état raconte l\u0027autre état (re-rendu après un clic)', async () => {
    const { renderer: r } = renderer();
    const before = JSON.stringify((await r.render(definition, STATE)).toJSON());
    const after = JSON.stringify((await r.render(definition, { game: { hand: ['R♣'], coins: 80 }, player: 'Paul' })).toJSON());
    expect(before).not.toBe(after);
    expect(after).toContain('R♣');
    expect(after).toContain('Tour de Paul');
  });

  it('sans état fourni, les références vides ne laissent ni accolades ni « undefined »', async () => {
    const { renderer: r } = renderer();
    const json = JSON.stringify((await r.render(definition)).toJSON());
    expect(json).not.toContain('{{');
    expect(json).not.toContain('undefined');
    expect(json).toContain('Blackjack : table de Paul');
  });
});
