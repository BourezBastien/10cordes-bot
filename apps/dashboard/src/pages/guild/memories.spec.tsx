import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoriesPage, correctionRows, memoryRows } from './memories';
import { guildPath, jsonResponse, renderWithProviders, stubRoutes } from '@/test/render';

/*
 * La page Mémoires : les fiches du serveur et des membres, les corrections
 * qui priment, et la marque posée sur une entrée qu’une correction a
 * périmée. Un bot d’une version antérieure, qui ne renvoie pas les
 * corrections, reste lisible.
 */

const date = () => '01/01/2026';

const entry = (id: string, content: string, supersededAt: string | null = null) => ({ id, kind: 'fact', content, createdAt: '2026-01-01T10:00:00.000Z', supersededAt });

describe('memories', () => {
  it('une entrée périmée porte la marque, et n’a plus sa nature en badge', () => {
    const rows = memoryRows([entry('a', 'aime les pizzas'), entry('b', 'habite à Lille', '2026-01-02T10:00:00.000Z')], date, (kind) => kind.toUpperCase(), 'Périmée');
    expect(rows.map((row) => [row.badge, row.tone])).toEqual([
      ['FACT', 'neutral'],
      ['Périmée', 'neutral'],
    ]);
  });

  it('une correction se lit : le fait corrigé, ce qu’il remplace, la date, et le membre', () => {
    const rows = correctionRows(
      [
        { id: 'c1', userId: null, oldFact: 'le fondateur habite à Lille', newFact: 'le fondateur habite à Lyon', createdAt: '2026-01-01T10:00:00.000Z', supersededAt: null },
        { id: 'c2', userId: '1550000000000000002', oldFact: 'habite à Lille', newFact: 'habite à Lyon', createdAt: '2026-01-01T10:00:00.000Z', supersededAt: null },
      ],
      date,
      'remplace',
      'Corrigé',
    );
    expect(rows[0]).toMatchObject({ time: '01/01/2026', tone: 'warn', badge: 'Corrigé', text: 'le fondateur habite à Lyon (remplace : le fondateur habite à Lille)', meta: null });
    expect(rows[1]?.meta).toBe('1550000000000000002');
  });

  it('la page montre les corrections, marque l’entrée périmée, et compte les fiches encore lues', async () => {
    stubRoutes({
      [`GET ${guildPath('/memories')}`]: () =>
        jsonResponse({
          guild: [entry('g1', 'le fondateur habite à Lille', '2026-01-02T10:00:00.000Z'), entry('g2', 'pas de spoilers')],
          members: [{ ...entry('m1', 'aime les pizzas'), userId: '1550000000000000002' }],
          corrections: [{ id: 'c1', userId: null, oldFact: 'le fondateur habite à Lille', newFact: 'le fondateur habite à Lyon', createdAt: '2026-01-01T10:00:00.000Z', supersededAt: null }],
        }),
    });
    const { container } = renderWithProviders(<MemoriesPage />);
    expect(await screen.findAllByText('Périmée')).toHaveLength(1);
    expect(await screen.findAllByText('Corrigé')).toHaveLength(1);
    expect(container.textContent).toContain('le fondateur habite à Lyon (remplace : le fondateur habite à Lille)');
    expect(container.textContent).toContain('1 fiche');
  });

  it('sans corrections renvoyées (bot d’une version antérieure), la page reste lisible', async () => {
    stubRoutes({
      [`GET ${guildPath('/memories')}`]: () => jsonResponse({ guild: [], members: [] }),
    });
    const { container } = renderWithProviders(<MemoriesPage />);
    await screen.findAllByText('Aucune correction.');
    expect(container.textContent).not.toContain('Une erreur est survenue');
  });
});
