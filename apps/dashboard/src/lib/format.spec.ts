import { describe, expect, it } from 'vitest';
import { formatDuration, formattersOf } from '@/lib/format';

describe('formatDuration', () => {
  it('écrit m:ss sous une heure', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(42_000)).toBe('0:42');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_599_000)).toBe('59:59');
  });

  it('écrit h:mm:ss au-delà d’une heure', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('bornée à zéro, jamais négative', () => {
    expect(formatDuration(-5_000)).toBe('0:00');
  });
});

describe('formattersOf', () => {
  const fr = formattersOf('fr-FR');

  it('sépare les milliers et compacte les grands nombres', () => {
    expect(fr.number(1_234_567)).toMatch(/^1.234.567$/u);
    expect(fr.compact(123_000)).toContain('123');
  });

  it('donne une chaîne vide pour une date illisible, jamais « Invalid Date »', () => {
    expect(fr.date('pas une date')).toBe('');
    expect(fr.time(Number.NaN)).toBe('');
  });

  it('lit une date ISO et des epoch millisecondes', () => {
    const instant = Date.UTC(2026, 10, 25, 12, 0, 0);
    expect(fr.date(instant)).toBe(fr.date(new Date(instant).toISOString()));
    expect(fr.date(instant)).not.toBe('');
  });

  it('dit « il y a » pour un passé récent, et la date au-delà', () => {
    const now = Date.UTC(2026, 10, 25, 12, 0, 0);
    expect(fr.ago(now - 5 * 60_000, now)).toContain('5');
    expect(fr.ago(now + 3_600_000, now)).not.toBe('');
    expect(fr.ago('pas une date', now)).toBe('');
  });
});
