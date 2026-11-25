import { describe, expect, it } from 'vitest';
import { isPublicHttpsUrl, splitUrl } from '@/lib/url';

/*
 * Contrôle d'écriture des adresses : https obligatoire, refus des hôtes
 * visiblement privés ou locaux. Le bot refait le contrôle en résolvant le
 * nom ; ici, pas de requête, pas de DNS.
 */

describe('isPublicHttpsUrl', () => {
  it('accepte une adresse https vers un hôte public', () => {
    expect(isPublicHttpsUrl('https://api.exemple.com/v1')).toBe(true);
    expect(isPublicHttpsUrl('https://hooks.exemple.com/alert?x=1')).toBe(true);
  });

  it('refuse tout ce qui n’est pas https', () => {
    expect(isPublicHttpsUrl('http://api.exemple.com/v1')).toBe(false);
    expect(isPublicHttpsUrl('ftp://api.exemple.com')).toBe(false);
    expect(isPublicHttpsUrl('api.exemple.com/v1')).toBe(false);
    expect(isPublicHttpsUrl('')).toBe(false);
  });

  it('refuse les hôtes locaux et privés, par leur écriture', () => {
    const refused = [
      'https://localhost/v1',
      'https://localhost:8443/v1',
      'https://LOCALHOST/v1',
      'https://127.0.0.1/v1',
      'https://127.8.8.8:3000',
      'https://0.0.0.0/',
      'https://10.1.2.3/v1',
      'https://192.168.1.10',
      'https://169.254.169.254/latest/meta-data',
      'https://172.16.0.1',
      'https://172.31.255.254',
      'https://[::1]/v1',
      'https://[fd00::1]/',
      'https://[fe80::1]/',
      'https://bot.local',
      'https://service.internal',
    ];
    for (const url of refused) expect(isPublicHttpsUrl(url), url).toBe(false);
  });

  it('laisse passer une adresse publique qui ressemble à une plage privée', () => {
    expect(isPublicHttpsUrl('https://172.32.0.1')).toBe(true);
    expect(isPublicHttpsUrl('https://102.168.1.1')).toBe(true);
    expect(isPublicHttpsUrl('https://11.0.0.1')).toBe(true);
  });
});

describe('splitUrl', () => {
  it('sépare l’hôte du chemin et de la requête', () => {
    expect(splitUrl('https://hooks.exemple.com/v1/alert?source=10cordes')).toEqual({
      host: 'hooks.exemple.com',
      path: '/v1/alert?source=10cordes',
    });
  });

  it('rend le texte tel quel s’il n’est pas une adresse', () => {
    expect(splitUrl('pas une adresse')).toEqual({ host: 'pas une adresse', path: '' });
  });
});
