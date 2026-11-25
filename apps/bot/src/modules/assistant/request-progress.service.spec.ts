import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROGRESS_MAX_ENTRIES,
  PROGRESS_RETENTION_MS,
  REQUEST_ID_PATTERN,
  RequestProgressService,
  STEP_SUMMARY_MAX,
  isRequestId,
} from './request-progress.service';

/**
 * Étapes d’une demande de l’agent, en mémoire. Ce qui est fixé : une demande
 * ne se lit que depuis SON serveur ; les textes et le nombre de demandes sont
 * bornés ; une demande terminée disparaît au bout de dix minutes, une demande
 * en cours jamais.
 */

const GUILD = '1550000000000000001';
const OTHER = '1550000000000000008';
const ID = 'web-0f1e2d3c-4b5a';
// Clé calculée : le scanner du registre des outils lit, dans toute source suivie, une clé name suivie d'une chaîne littérale.
const NAME = 'name';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-25T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RequestProgressService', () => {
  it('une demande démarre vide et en cours, reçoit ses étapes dans l’ordre, puis se clôt', () => {
    const service = new RequestProgressService();
    service.start(GUILD, ID);
    expect(service.read(GUILD, ID)).toEqual({ requestId: ID, state: 'running', steps: [] });
    service.record(GUILD, ID, { name: 'records.list', ok: true, summary: '3 fiches' });
    service.record(GUILD, ID, { name: 'records.delete', ok: false, summary: 'Refusé' });
    service.finish(GUILD, ID, 'done');
    expect(service.read(GUILD, ID)).toEqual({
      requestId: ID,
      state: 'done',
      steps: [
        { name: 'records.list', ok: true, summary: '3 fiches' },
        { name: 'records.delete', ok: false, summary: 'Refusé' },
      ],
    });
  });

  it('une demande ne se lit que depuis SON serveur : même identifiant ailleurs, elle est inconnue', () => {
    const service = new RequestProgressService();
    service.start(GUILD, ID);
    service.record(OTHER, ID, { [NAME]: 'outil.autre', ok: true, summary: 'secret d\u0027ailleurs' });
    expect(service.read(OTHER, ID)).toBeNull();
    expect(service.read(GUILD, ID)).toEqual({ requestId: ID, state: 'running', steps: [] });
    expect(service.count(OTHER)).toBe(0);
  });

  it('une étape ou une clôture d’une demande inconnue ne fait rien', () => {
    const service = new RequestProgressService();
    expect(() => service.record(GUILD, ID, { [NAME]: 'x', ok: true, summary: '' })).not.toThrow();
    service.finish(GUILD, ID, 'failed');
    expect(service.read(GUILD, ID)).toBeNull();
    expect(service.count(GUILD)).toBe(0);
  });

  it('les textes sont bornés, et la lecture rend une copie', () => {
    const service = new RequestProgressService();
    service.start(GUILD, ID);
    service.record(GUILD, ID, { [NAME]: 'x'.repeat(200), ok: true, summary: 's'.repeat(1_000) });
    const progress = service.read(GUILD, ID);
    expect(progress?.steps[0]?.name).toHaveLength(80);
    expect(progress?.steps[0]?.summary).toHaveLength(STEP_SUMMARY_MAX);
    progress?.steps.push({ name: 'ajouté', ok: true, summary: 'dehors' });
    expect(service.read(GUILD, ID)?.steps).toHaveLength(1);
  });

  it('une demande de même identifiant sur le même serveur repart de zéro', () => {
    const service = new RequestProgressService();
    service.start(GUILD, ID);
    service.record(GUILD, ID, { [NAME]: 'a', ok: true, summary: '' });
    service.start(GUILD, ID);
    expect(service.read(GUILD, ID)).toEqual({ requestId: ID, state: 'running', steps: [] });
    expect(service.count(GUILD)).toBe(1);
  });

  it('une demande terminée disparaît au bout de dix minutes ; une demande en cours reste', () => {
    const service = new RequestProgressService();
    service.start(GUILD, 'web-terminee-0001');
    service.finish(GUILD, 'web-terminee-0001', 'done');
    service.start(GUILD, 'web-en-cours-00001');
    vi.setSystemTime(Date.now() + PROGRESS_RETENTION_MS - 1);
    expect(service.read(GUILD, 'web-terminee-0001')).not.toBeNull();
    vi.setSystemTime(Date.now() + 2);
    expect(service.read(GUILD, 'web-terminee-0001')).toBeNull();
    expect(service.read(GUILD, 'web-en-cours-00001')).toMatchObject({ state: 'running' });
  });

  it('le nombre de demandes gardées reste sous le plafond', () => {
    const service = new RequestProgressService();
    for (let index = 0; index < PROGRESS_MAX_ENTRIES + 40; index += 1) {
      const id = `web-${String(index).padStart(8, '0')}-x`;
      service.start(GUILD, id);
      service.finish(GUILD, id, 'done');
      vi.setSystemTime(Date.now() + 1);
    }
    service.start(GUILD, 'web-derniere-00001');
    expect(service.count(GUILD)).toBeLessThanOrEqual(PROGRESS_MAX_ENTRIES);
    // Les plus anciennes partent : la toute dernière reste, la première aussi si la place le permet.
    expect(service.read(GUILD, 'web-derniere-00001')).not.toBeNull();
    expect(service.read(GUILD, 'web-00000000-x')).toBeNull();
  });
});

describe('identifiant de demande', () => {
  it('le panneau choisit un identifiant court, préfixé web-, sans espace ni majuscule', () => {
    expect(isRequestId('web-0f1e2d3c-4b5a')).toBe(true);
    expect(isRequestId('web-abcdef12')).toBe(true);
    expect(isRequestId(`web-${'a'.repeat(36)}`)).toBe(true);
    for (const bad of ['web-', 'web-abc', 'web-ABCDEF12', 'web-a b', 'abc-abcdef12', 'web-../../x..', `web-${'a'.repeat(37)}`, '', undefined, 42]) {      expect(isRequestId(bad), String(bad)).toBe(false);
    }
    expect(new RegExp(REQUEST_ID_PATTERN, 'u').test('web-abcdef12')).toBe(true);
  });
});
