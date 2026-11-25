import { describe, expect, it } from 'vitest';
import { loginPath, returnPath } from './return-path';

/*
 * Le retour après la connexion : seuls les chemins des serveurs sont repris.
 * Une autre origine, un chemin d'une autre page ou une valeur d'une autre
 * nature ramènent à la connexion nue.
 */

describe('returnPath', () => {
  it('reprend les chemins des serveurs, avec leur chaîne de requête', () => {
    expect(returnPath('/guilds')).toBe('/guilds');
    expect(returnPath('/guilds/1550835980116824136')).toBe('/guilds/1550835980116824136');
    expect(returnPath('/guilds/1550835980116824136/providers')).toBe('/guilds/1550835980116824136/providers');
    expect(returnPath('/guilds?page=2')).toBe('/guilds?page=2');
  });

  it('ne reprend ni une autre origine, ni une autre page, ni une valeur d\u0027une autre nature', () => {
    for (const value of ['https://malveillant.exemple.test/guilds', '//malveillant.exemple.test/guilds', '/login', '/legal/terms', 'guilds', '', undefined, null, 42, { path: '/guilds' }]) {
      expect(returnPath(value), String(value)).toBeUndefined();
    }
  });
});

describe('loginPath', () => {
  it('la connexion porte le chemin demandé, encodé ; sans lui, elle est nue', () => {
    expect(loginPath('/guilds/1550835980116824136/rules')).toBe('/login?redirect=%2Fguilds%2F1550835980116824136%2Frules');
    expect(loginPath('/guilds?page=2&tri=nom')).toBe('/login?redirect=%2Fguilds%3Fpage%3D2%26tri%3Dnom');
    expect(loginPath('/')).toBe('/login');
    expect(loginPath('/autre')).toBe('/login');
  });
});
