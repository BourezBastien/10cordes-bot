import { describe, expect, it } from 'vitest';
import { describeCoverage, toLocalDay } from './activity-coverage';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 10, 23, 17, 31).getTime(); // 23/11/2026 17:31, heure locale

describe('toLocalDay', () => {
  it('formate un jour local avec zéros non significatifs', () => {
    expect(toLocalDay(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toLocalDay(new Date(2026, 10, 23))).toBe('2026-11-23');
  });
});

describe('describeCoverage', () => {
  it('rend 0 jour et une ligne explicite sans aucune donnée', () => {
    const coverage = describeCoverage({ sinceMs: null, days: 7, now: NOW });
    expect(coverage.effectiveDays).toBe(0);
    expect(coverage.line).toBe('coverageSince: aucune donnée.');
  });

  it('annonce la profondeur en heures quand la fenêtre est à peine couverte', () => {
    // Première donnée 21 h plus tôt : la fenêtre de 7 jours n'est couverte que sur 1 jour.
    const coverage = describeCoverage({ sinceMs: NOW - 21 * HOUR, days: 7, now: NOW });
    expect(coverage.effectiveDays).toBe(1);
    expect(coverage.line).toBe(
      "coverageSince: 2026-11-22 (première donnée il y a 21 h : la fenêtre de 7 jour(s) n'est couverte que sur 1 jour(s) ; la moyenne se calcule sur cette profondeur).",
    );
  });

  it('annonce la profondeur en jours pour une couverture partielle plus longue', () => {
    const coverage = describeCoverage({ sinceMs: NOW - 3 * DAY - 6 * HOUR, days: 7, now: NOW });
    expect(coverage.effectiveDays).toBe(4);
    expect(coverage.line).toContain("première donnée il y a 3,3 j : la fenêtre de 7 jour(s) n'est couverte que sur 4 jour(s)");
  });

  it('borne les jours effectifs à la fenêtre demandée quand les données sont plus anciennes', () => {
    const coverage = describeCoverage({ sinceMs: NOW - 30 * DAY, days: 7, now: NOW });
    expect(coverage.effectiveDays).toBe(7);
    expect(coverage.line).toBe('coverageSince: 2026-10-24 (données complètes sur toute la fenêtre de 7 jour(s)).');
  });

  it('garde au minimum 1 jour de couverture pour une première donnée toute récente', () => {
    const coverage = describeCoverage({ sinceMs: NOW, days: 7, now: NOW });
    expect(coverage.effectiveDays).toBe(1);
    expect(coverage.line).toContain('il y a 1 h');
  });
});
