import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../test/fake-db';
import { decryptSecret } from '../../shared/crypto/secret-box';
import { bindRegistryInstance } from '../tool-registry/tool-registry.runtime';
import type { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { IntegrationService } from './integration.service';

/**
 * Configuration d'INSTANCE, en base, clé chiffrée. Ce que fixent ces tests :
 * l'environnement ne sert qu'à remplir une base vide, une seule fois par
 * processus ; dès que la base connaît une intégration, il est ignoré pour
 * tout le catalogue ; l'import ne peut jamais faire échouer l'amorçage.
 */

// Clé factice, sans valeur utilisable : c'est aussi la clé maîtresse de chiffrement des specs.
const KEY = 'test-key-not-real';
const SECRETS = { token: 'x', ENCRYPTION_SECRET: KEY };
/** Les variables d'environnement que le fichier du owner peut porter : elles ne servent qu'à remplir une base vide. */
type Env = Partial<Record<'LLM_API_URL' | 'LLM_API_KEY' | 'LLM_MODEL' | 'KIE_API_KEY' | 'KIE_MODEL' | 'PIXELLAB_API_KEY', string>>;

/** Tout ce que le fichier d'environnement du owner peut porter. */
const FULL_ENV: Env = {
  LLM_API_URL: 'https://api.deepseek.com',
  LLM_API_KEY: `${KEY}-llm`,
  LLM_MODEL: 'deepseek-flash',
  KIE_API_KEY: `${KEY}-kie`,
  KIE_MODEL: 'V6_MINI',
  PIXELLAB_API_KEY: `${KEY}-pixel`,
};

function harness(env: Env = {}) {
  const db = fakeDb();
  const audit = { record: vi.fn() };
  const service = new IntegrationService(db as never, audit as never, { ...SECRETS, ...env } as never);
  return { db, audit, service };
}

const rowsOf = (db: ReturnType<typeof fakeDb>) => [...db.integrationConfig.rows.values()];

describe('IntegrationService · import unique de l\u0027environnement', () => {
  it('une base vide est remplie depuis l\u0027environnement, clés chiffrées, et la première lecture l\u0027attend', async () => {
    const { db, service } = harness(FULL_ENV);
    // Aucun appel explicite : la première lecture déclenche l'import et l'attend.
    const pixellab = await service.get('pixellab');
    expect(pixellab).toEqual({ id: 'pixellab', config: { apiKey: `${KEY}-pixel` }, source: 'db' });
    expect(rowsOf(db).map((row) => row.id).sort()).toEqual(['kie', 'llm', 'pixellab']);

    const llm = rowsOf(db).find((row) => row.id === 'llm');
    expect(llm).toMatchObject({ kind: 'llm', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' });
    expect(String(llm?.apiKey).startsWith('v1:')).toBe(true);
    expect(llm?.apiKey).not.toContain(KEY);
    expect(decryptSecret(String(llm?.apiKey), { encryption: KEY, token: 'x' })).toBe(`${KEY}-llm`);
    expect(rowsOf(db).find((row) => row.id === 'kie')).toMatchObject({ model: 'V6_MINI' });

    expect(await service.get('llm')).toEqual({ id: 'llm', config: { apiKey: `${KEY}-llm`, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }, source: 'db' });
  });

  it('l\u0027import ne court qu\u0027une fois par processus : un second appel ne réécrit rien', async () => {
    const { db, service, audit } = harness(FULL_ENV);
    // Copie triée : trier le tableau rendu le modifierait aussi dans l'audit déjà écrit.
    expect([...(await service.importFromEnv())].sort()).toEqual(['kie', 'llm', 'pixellab']);
    db.integrationConfig.upsert.mockClear();
    expect([...(await service.importFromEnv())].sort()).toEqual(['kie', 'llm', 'pixellab']);
    expect(db.integrationConfig.upsert).not.toHaveBeenCalled();
    // Une trace d\u0027audit pour l\u0027import, sans jamais une clé.
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ guildId: null, action: 'instance.imported', actorId: 'bootstrap', metadata: { ids: ['llm', 'pixellab', 'kie'] } }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(KEY);
  });

  it('une ligne existante n\u0027est jamais réécrite, même si l\u0027environnement a changé', async () => {
    const { db, service } = harness({ LLM_API_URL: 'https://env.example.test', LLM_API_KEY: `${KEY}-env`, LLM_MODEL: 'env-model' });
    await service.upsert('llm', { apiKey: `${KEY}-db`, baseUrl: 'https://db.example.test', model: 'db-model' }, 'admin');
    expect(await service.importFromEnv()).toEqual([]);
    expect(await service.get('llm')).toEqual({ id: 'llm', config: { apiKey: `${KEY}-db`, baseUrl: 'https://db.example.test', model: 'db-model' }, source: 'db' });
    expect(db.integrationConfig.upsert).toHaveBeenCalledTimes(1);
  });

  it('sans clé dans l\u0027environnement, rien n\u0027est importé (une URL seule ne suffit pas)', async () => {
    const { db, service } = harness({ LLM_API_URL: 'https://api.deepseek.com', LLM_MODEL: 'deepseek-flash' });
    expect(await service.importFromEnv()).toEqual([]);
    expect(rowsOf(db)).toEqual([]);
    expect(await service.get('llm')).toEqual({ id: 'llm', config: {}, source: 'none' });
  });

  it('l\u0027amorçage attend la fin de l\u0027import', async () => {
    bindRegistryInstance({ register: vi.fn() } as unknown as ToolRegistryService);
    const { db, service } = harness(FULL_ENV);
    await service.onBoot();
    expect(rowsOf(db).map((row) => row.id).sort()).toEqual(['kie', 'llm', 'pixellab']);
  });
});

describe('IntegrationService · la base a la priorité absolue', () => {
  it('base vide et import impossible : l\u0027environnement sert en attendant', async () => {
    const { db, service } = harness({ LLM_API_URL: 'https://api.deepseek.com', LLM_API_KEY: `${KEY}-llm`, LLM_MODEL: 'deepseek-flash' });
    db.integrationConfig.upsert.mockRejectedValueOnce(new Error('database is locked'));
    expect(await service.importFromEnv()).toEqual([]);
    expect(await service.get('llm')).toEqual({ id: 'llm', config: { apiKey: `${KEY}-llm`, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }, source: 'env' });
  });

  it('dès que la base connaît une intégration, l\u0027environnement est ignoré pour tout le catalogue', async () => {
    const { db, service } = harness({ LLM_API_URL: 'https://api.deepseek.com', LLM_API_KEY: `${KEY}-llm`, LLM_MODEL: 'deepseek-flash' });
    await service.upsert('pixellab', { apiKey: `${KEY}-pixel` }, 'admin');
    // L\u0027import de la ligne du fournisseur IA échoue : la variable d\u0027environnement ne prend pas le relais.
    db.integrationConfig.upsert.mockRejectedValueOnce(new Error('database is locked'));
    expect(await service.importFromEnv()).toEqual([]);
    expect(await service.get('llm')).toEqual({ id: 'llm', config: {}, source: 'none' });
  });

  it('une ligne supprimée par un administrateur, base non vide : rien ne la ressuscite', async () => {
    const { db, service } = harness({});
    await service.upsert('llm', { apiKey: `${KEY}-db`, baseUrl: 'https://db.example.test' }, 'admin');
    await service.upsert('pixellab', { apiKey: `${KEY}-pixel` }, 'admin');
    await service.importFromEnv();
    expect(await service.remove('llm')).toBe(true);
    expect(await service.get('llm')).toEqual({ id: 'llm', config: {}, source: 'none' });
    expect(await service.get('pixellab')).toMatchObject({ source: 'db' });
    expect(rowsOf(db).map((row) => row.id)).toEqual(['pixellab']);
  });

  it('une intégration hors catalogue n\u0027existe pas', async () => {
    const { service } = harness(FULL_ENV);
    expect(await service.get('inconnue')).toEqual({ id: 'inconnue', config: {}, source: 'none' });
    await expect(service.upsert('inconnue', { apiKey: KEY }, 'admin')).rejects.toThrow('inconnue');
  });

  it('une erreur inattendue pendant l\u0027import ne rejette jamais', async () => {
    const { db, service } = harness(FULL_ENV);
    db.integrationConfig.findUnique.mockRejectedValueOnce(new Error('database is locked'));
    expect((await service.importFromEnv()).sort()).toEqual(['kie', 'llm', 'pixellab']);
  });
});

describe('IntegrationService · statut masqué', () => {
  it('la clé n\u0027y paraît jamais, seulement ses extrémités', async () => {
    const { service } = harness(FULL_ENV);
    const status = await service.status('llm');
    expect(status).toMatchObject({ id: 'llm', source: 'db', model: 'deepseek-flash' });
    expect(status.maskedKey).toContain('…');
    expect(JSON.stringify(status)).not.toContain(KEY);
    expect(await service.status('inconnue')).toMatchObject({ label: 'inconnue', source: 'none', maskedKey: null });
  });
});
