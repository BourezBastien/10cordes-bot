import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Instance better-auth du dashboard, configurée par le bot. La bibliothèque et
 * Prisma sont remplacés : ce qui est fixé ici, c’est la CONFIGURATION passée
 * (adresse publique, origines de confiance, cookie sécurisé, périmètre OAuth
 * réduit à l’identité) et le devenir des jetons OAuth (effacés dès le compte
 * lié, le snowflake reste). Une authentification absente ferme l’accès.
 */

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn(),
  prismaAdapter: vi.fn(),
  /** Un client factice par création : l'adresse reçue, et de quoi jouer l'effacement des jetons. */
  createDatabaseClient: vi.fn(),
  prismaInstances: [] as Array<{ url: string | undefined; account: { updateMany: ReturnType<typeof vi.fn> } }>,
  env: { value: {} as Record<string, unknown> },
}));

vi.mock('better-auth', () => ({ betterAuth: mocks.betterAuth }));
vi.mock('better-auth/adapters/prisma', () => ({ prismaAdapter: mocks.prismaAdapter }));
// Le vrai client ouvrirait la base : ici, il est factice, et sa fabrique garde l'adresse reçue.
vi.mock('../modules/database/database-client', () => ({ createDatabaseClient: mocks.createDatabaseClient }));
vi.mock('./env.accessor', () => ({ getValidatedEnv: () => mocks.env.value }));

// Clé calculée : le scanner du registre des outils lit, dans toute source suivie, une clé name suivie d'une chaîne littérale.
const NAME = 'name';
const SESSION = { session: { id: 's1', userId: 'u1' }, user: { id: 'u1', [NAME]: 'Test' } };

// Noms des variables d’environnement et valeurs factices, sans valeur utilisable.
const SECRET_NAME = 'BETTER_AUTH_SECRET';
const CLIENT_ID_NAME = 'DISCORD_CLIENT_ID';
const CLIENT_SECRET_NAME = 'DISCORD_CLIENT_SECRET';
const SESSION_TEST = 'test-secret-not-real-00000000000000000000';
const OAUTH_TEST = 'test-secret-not-real-oauth';

const CONFIGURED: Record<string, string | number> = {
  [SECRET_NAME]: SESSION_TEST,
  [CLIENT_ID_NAME]: 'client-id-test',
  [CLIENT_SECRET_NAME]: OAUTH_TEST,
  DASHBOARD_ORIGIN: 'https://panel.exemple.test, http://localhost:5173',
  DATABASE_URL: 'file:./data/bot.db',
  PORT: 3000,
};

/** Charge le module à neuf (l’instance better-auth est mémorisée à l’échelle du module). */
async function fresh() {
  vi.resetModules();
  return import('./auth.instance');
}

interface Options {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  advanced: { useSecureCookies: boolean };
  socialProviders: { discord: { clientId: string; clientSecret: string; scopes: string[] } };
  emailAndPassword: { enabled: boolean };
  databaseHooks: {
    account: { create: { after: (account: { id: string }) => Promise<void> }; update: { after: (account: { id: string }) => Promise<void> } };
  };
}

const lastOptions = (): Options => mocks.betterAuth.mock.calls.at(-1)?.[0] as Options;

beforeEach(() => {
  mocks.betterAuth.mockReset().mockImplementation(() => ({ handler: vi.fn(), api: { getSession: vi.fn(async () => SESSION) } }));
  mocks.prismaAdapter.mockReset().mockImplementation(() => ({ provider: 'sqlite' }));
  mocks.createDatabaseClient.mockReset().mockImplementation((url: string | undefined) => {
    const account = { updateMany: vi.fn(async () => ({ count: 1 })) };
    mocks.prismaInstances.push({ url, account });
    return { account };
  });
  mocks.prismaInstances.length = 0;
  mocks.env.value = { ...CONFIGURED };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isAuthConfigured', () => {
  it('exige le secret de session, l’identifiant OAuth et le secret OAuth', async () => {
    const { isAuthConfigured } = await fresh();
    expect(isAuthConfigured(CONFIGURED as never)).toBe(true);
    for (const missing of [SECRET_NAME, CLIENT_ID_NAME, CLIENT_SECRET_NAME]) {
      expect(isAuthConfigured({ ...CONFIGURED, [missing]: undefined } as never), missing).toBe(false);
      expect(isAuthConfigured({ ...CONFIGURED, [missing]: '' } as never), missing).toBe(false);
    }
  });
});

describe('getAuth', () => {
  it('sans configuration : lève en nommant les variables absentes, et la bibliothèque n’est pas appelée', async () => {
    const { getAuth } = await fresh();
    expect(() => getAuth({ ...CONFIGURED, [CLIENT_ID_NAME]: undefined } as never)).toThrow(CLIENT_ID_NAME);
    expect(mocks.betterAuth).not.toHaveBeenCalled();
  });

  it('configure better-auth : adresse publique du dashboard, origines de confiance exactes, cookie sécurisé en https', async () => {
    const { getAuth } = await fresh();
    getAuth(CONFIGURED as never);
    const options = lastOptions();
    expect(options.baseURL).toBe('https://panel.exemple.test');
    expect(options.trustedOrigins).toEqual(['https://panel.exemple.test', 'http://localhost:5173']);
    expect(options.advanced).toEqual({ useSecureCookies: true });
    expect(options.secret).toBe(SESSION_TEST);
    expect(mocks.prismaAdapter).toHaveBeenCalledTimes(1);
  });

  it('en http (développement local), le cookie n’est pas marqué Secure', async () => {
    const { getAuth } = await fresh();
    getAuth({ ...CONFIGURED, DASHBOARD_ORIGIN: 'http://localhost:5173' } as never);
    expect(lastOptions().baseURL).toBe('http://localhost:5173');
    expect(lastOptions().advanced.useSecureCookies).toBe(false);
  });

  it('sans origine réglée, l’adresse publique est celle du serveur HTTP du bot, et rien n’est de confiance', async () => {
    const { getAuth } = await fresh();
    getAuth({ ...CONFIGURED, DASHBOARD_ORIGIN: undefined } as never);
    expect(lastOptions().baseURL).toBe('http://127.0.0.1:3000');
    expect(lastOptions().trustedOrigins).toEqual([]);
  });

  it('le périmètre OAuth est réduit à l’identité, et aucun mot de passe n’est accepté', async () => {
    const { getAuth } = await fresh();
    getAuth(CONFIGURED as never);
    expect(lastOptions().socialProviders.discord).toEqual({ clientId: 'client-id-test', clientSecret: OAUTH_TEST, scopes: ['identify'] });
    expect(lastOptions().emailAndPassword).toEqual({ enabled: false });
  });

  it('l’instance est unique, et sa base lui est propre (un client à elle, sur l’adresse de la base)', async () => {
    const { getAuth } = await fresh();
    const first = getAuth(CONFIGURED as never);
    expect(getAuth(CONFIGURED as never)).toBe(first);
    expect(mocks.betterAuth).toHaveBeenCalledTimes(1);
    expect(mocks.prismaInstances).toHaveLength(1);
    expect(mocks.prismaInstances[0]?.url).toBe('file:./data/bot.db');
    expect(mocks.prismaAdapter).toHaveBeenCalledTimes(1);
  });
});

describe('jetons OAuth', () => {
  it('à la création comme à la mise à jour du compte lié, les jetons sont effacés et le snowflake reste', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { getAuth } = await fresh();
    getAuth(CONFIGURED as never);
    const hooks = lastOptions().databaseHooks.account;
    await hooks.create.after({ id: 'compte-1' });
    await hooks.update.after({ id: 'compte-1' });
    const updateMany = mocks.prismaInstances[0]?.account.updateMany;
    expect(updateMany).toHaveBeenCalledTimes(2);
    const erased = { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null };
    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: 'compte-1' }, data: erased });
    expect('accountId' in erased).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('un effacement qui échoue se dit, sans faire échouer la connexion et sans jamais un jeton', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { getAuth } = await fresh();
    getAuth(CONFIGURED as never);
    mocks.prismaInstances[0]?.account.updateMany.mockRejectedValueOnce(new Error('database is locked'));
    await expect(lastOptions().databaseHooks.account.create.after({ id: 'compte-1' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('jetons OAuth non effacés');
  });
});

describe('readSession', () => {
  it('sans login configuré : aucune session, et la bibliothèque n’est pas interrogée', async () => {
    const { readSession } = await fresh();
    mocks.env.value = { ...CONFIGURED, [CLIENT_ID_NAME]: undefined };
    expect(await readSession(new Headers({ cookie: 'session=x' }))).toBeNull();
    expect(mocks.betterAuth).not.toHaveBeenCalled();
  });

  it('configuré : la session est lue par la bibliothèque, avec les en-têtes de la requête', async () => {
    const { readSession } = await fresh();
    const headers = new Headers({ cookie: 'session=valide' });
    expect(await readSession(headers)).toEqual(SESSION);
    const api = (mocks.betterAuth.mock.results[0]?.value as { api: { getSession: ReturnType<typeof vi.fn> } }).api;
    expect(api.getSession).toHaveBeenCalledWith({ headers });
  });
});
