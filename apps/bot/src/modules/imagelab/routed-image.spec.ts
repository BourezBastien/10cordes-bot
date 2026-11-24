import { describe, expect, it, vi } from 'vitest';
import { safeFetch } from '../../shared/utils/safe-fetch';
import { IMAGE_RATIOS, PENDING_MESSAGE, firstImageBytes, imageRequestOf } from './routed-image';

vi.mock('../../shared/utils/safe-fetch', () => ({ safeFetch: vi.fn(async () => new Response('octets')) }));

/**
 * Lecture d'un résultat de la capacité image.generate : les deux protocoles
 * n'ont pas la même forme, l'outil ne voit que des octets. Une image rendue
 * par URL est téléchargée par la garde des requêtes sortantes (jamais un
 * `fetch` brut : l'URL vient du fournisseur).
 */

describe('firstImageBytes', () => {
  it('base64 (protocole OpenAI-compatible) : les octets, sans requête', async () => {
    expect((await firstImageBytes({ images: [{ b64_json: Buffer.from('png').toString('base64') }] })).toString()).toBe('png');
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['une image OpenAI-compatible rendue par URL', { images: [{ url: 'https://cdn.example.test/a.png' }] }, 'https://cdn.example.test/a.png'],
    ['une tâche kie.ai', { urls: ['https://cdn.example.test/task.png', 'https://cdn.example.test/second.png'] }, 'https://cdn.example.test/task.png'],
  ])('%s : première URL téléchargée par la garde', async (_label, data, url) => {
    vi.mocked(safeFetch).mockClear();
    expect((await firstImageBytes(data)).toString()).toBe('octets');
    expect(vi.mocked(safeFetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(safeFetch)).toHaveBeenCalledWith(url, { timeoutMs: 60_000 });
  });

  it('rien de livrable, ou une image vide : erreur explicite', async () => {
    await expect(firstImageBytes({})).rejects.toThrow('n\u0027a pas renvoyé d\u0027image');
    await expect(firstImageBytes({ images: [{ b64_json: '' }], urls: [] })).rejects.toThrow('n\u0027a pas renvoyé d\u0027image');
    await expect(firstImageBytes({ images: ' texte', urls: [42] })).rejects.toThrow('n\u0027a pas renvoyé d\u0027image');
    vi.mocked(safeFetch).mockResolvedValueOnce(new Response(''));
    await expect(firstImageBytes({ urls: ['https://cdn.example.test/vide.png'] })).rejects.toThrow('image vide');
  });

  it('chaque ratio a sa taille équivalente pour les API de type OpenAI', () => {
    expect(Object.keys(IMAGE_RATIOS)).toEqual(['1:1', '16:9', '9:16', '4:3', '3:4']);
    expect(IMAGE_RATIOS['16:9'].size).toBe('1536x1024');
    expect(IMAGE_RATIOS['9:16'].size).toBe('1024x1536');
    expect(IMAGE_RATIOS['1:1'].size).toBe('1024x1024');
    expect(PENDING_MESSAGE).toContain('réessaie dans une minute');
  });
});

describe('imageRequestOf', () => {
  it('nom de fichier et ratio, avec leurs valeurs par défaut', () => {
    expect(imageRequestOf({ prompt: 'un phare', label: 'Carte de GTA 7', aspect_ratio: '16:9' })).toEqual({ prompt: 'un phare', label: 'Carte-de-GTA-7', ratio: '16:9', size: '1536x1024' });
    expect(imageRequestOf({ prompt: 'un phare' })).toEqual({ prompt: 'un phare', label: 'image', ratio: '1:1', size: '1024x1024' });
    expect(imageRequestOf({ prompt: 'un phare', label: '   ', aspect_ratio: null })).toMatchObject({ label: 'image', ratio: '1:1' });
    expect(imageRequestOf({ prompt: 'un phare', label: '!!!' })).toMatchObject({ label: 'image' });
  });

  it('un appelant qui contourne le schéma ne fait pas échouer l\u0027outil : ratio inconnu ramené au carré, nom borné et sûr', () => {
    expect(imageRequestOf({ prompt: 'un phare', label: 'x'.repeat(60), aspect_ratio: '21:9' })).toMatchObject({ label: 'x'.repeat(40), ratio: '1:1' });
    // Une clé héritée du prototype n\u0027est pas un ratio.
    expect(imageRequestOf({ prompt: 'un phare', aspect_ratio: 'constructor' }).ratio).toBe('1:1');
    // Les accents et les autres écritures restent lisibles ; un chemin ne peut pas s\u0027y glisser.
    expect(imageRequestOf({ prompt: 'un phare', label: 'Été à la mer' }).label).toBe('Été-à-la-mer');
    expect(imageRequestOf({ prompt: 'un phare', label: '../../etc/passwd' }).label).toBe('-etc-passwd');
    expect(imageRequestOf({ prompt: 'un phare', label: '寄港 灯台' }).label).toBe('寄港-灯台');
  });
});
