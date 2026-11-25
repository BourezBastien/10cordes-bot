import { describe, expect, it } from 'vitest';
import { assertModelServes, detectModelKinds, guessModelKind, kindsOf, modelCapabilitiesOf, type ModelCapability } from './provider-model.kinds';
import { ProviderError, type ModelKind, type ProviderModel } from './provider.types';

/**
 * Ce qu'un modèle sait faire. Un fournisseur compatible OpenAI ne décrit
 * presque jamais ses modèles : les métadonnées font foi quand elles
 * existent, sinon la famille se lit dans l'identifiant.
 */

const KIE: ProviderModel[] = [
  { id: 'V6_MINI', kind: 'music' },
  { id: 'z-image', kind: 'image' },
];

describe('detectModelKinds', () => {
  it.each([
    ['deepseek-flash', 'chat'],
    ['gpt-4o', 'chat'],
    ['dall-e-3', 'image'],
    ['gpt-image-1', 'image'],
    ['flux-pro', 'image'],
    ['stable-diffusion-xl', 'image'],
    ['nano-banana', 'image'],
    ['sora-2', 'video'],
    ['kling-2.5', 'video'],
    ['gpt-4o-mini-tts', 'tts'],
    ['elevenlabs-v3', 'tts'],
    ['suno-v5', 'music'],
    ['whisper-1', 'other'],
    ['text-embedding-3-small', 'other'],
  ])('%s → %s', (id, kind) => {
    expect(detectModelKinds(id)).toEqual([kind]);
  });

  it('des sorties déclarées par les métadonnées font foi, avant l\u0027identifiant', () => {
    expect(detectModelKinds('vendor/painter', { architecture: { output_modalities: ['text', 'image'] } })).toEqual(['chat', 'image']);
    expect(detectModelKinds('gpt-4o', { output_modalities: ['image'] })).toEqual(['image']);
    expect(detectModelKinds('vendor/movie', { modalities: { output: ['text', 'video'] } })).toEqual(['chat', 'video']);
    expect(detectModelKinds('vendor/speech', { output_modality: 'audio' })).toEqual(['tts']);
  });

  it('des capacités déclarées « vrai » par les métadonnées comptent', () => {
    expect(detectModelKinds('vendor/all-in-one', { capabilities: { image_generation: true, chat: true } })).toEqual(['image']);
    expect(detectModelKinds('vendor/legacy', { capabilities: { image_generation: false } })).toEqual(['chat']);
  });

  it('métadonnées illisibles : la famille se lit dans l\u0027identifiant', () => {
    expect(detectModelKinds('flux-pro', ' texte')).toEqual(['image']);
    expect(detectModelKinds('vendor/x', ['text'])).toEqual(['chat']);
  });

  it('famille principale, et familles d\u0027une fiche ancienne ou récente', () => {
    expect(guessModelKind('flux-pro')).toBe('image');
    expect(guessModelKind('vendor/painter', { architecture: { output_modalities: ['text', 'image'] } })).toBe('chat');
    expect(kindsOf({ kind: 'image' })).toEqual(['image']);
    expect(kindsOf({ kind: 'chat', kinds: ['chat', 'image'] })).toEqual(['chat', 'image']);
    expect(kindsOf({ kinds: [] })).toEqual([]);
  });
});

describe('modelCapabilitiesOf', () => {
  it.each<[string, ModelKind[], ModelCapability[]]>([
    ['deepseek-flash', ['chat'], ['chat']],
    ['deepseek-reasoner', ['chat'], ['reasoning']],
    ['gpt-5', ['chat'], ['reasoning']],
    ['z-image', ['image'], ['image']],
    ['V6_MINI', ['music'], ['audio']],
    ['gpt-4o-mini-tts', ['tts'], ['audio']],
    ['sora-2', ['video'], ['video']],
    ['whisper-1', ['other'], []]],
  )('%s → %s', (id, kinds, capabilities) => {
    expect(modelCapabilitiesOf({ id, kinds })).toEqual(capabilities);
  });

  it('un modèle multimodal sert la conversation et l\u0027image', () => {
    expect(modelCapabilitiesOf({ id: 'vendor/painter', kind: 'chat', kinds: ['chat', 'image'] })).toEqual(['chat', 'image']);
  });
});

describe('assertModelServes', () => {
  it('un modèle du catalogue qui déclare ne pas servir la capacité : refus, avec ceux qui la servent', () => {
    const refusal = (() => {
      try {
        assertModelServes(KIE, 'z-image', 'music.generate', 'kie-ai');
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(refusal).toBeInstanceOf(ProviderError);
    expect((refusal as ProviderError).kind).toBe('invalid');
    expect((refusal as ProviderError).message).toBe('« z-image » ne sert pas musique (familles détectées : image). Modèles de kie-ai qui la servent : V6_MINI.');
  });

  it('une capacité sans aucun modèle dans le catalogue le dit', () => {
    expect(() => assertModelServes(KIE, 'z-image', 'tts.speak', 'kie-ai')).toThrow('aucun dans le catalogue');
  });

  it('passe : le modèle sert la capacité, ou est hors catalogue, ou la capacité est libre', () => {
    expect(() => assertModelServes(KIE, 'z-image', 'image.generate', 'kie-ai')).not.toThrow();
    expect(() => assertModelServes(KIE, 'mon-modele', 'music.generate', 'kie-ai')).not.toThrow();
    expect(() => assertModelServes(KIE, 'z-image', 'custom.kie-image', 'kie-ai')).not.toThrow();
    expect(() => assertModelServes([{ id: 'sans-famille' }], 'sans-famille', 'music.generate', 'autre')).not.toThrow();
  });

  it('la recherche web est une capacité native : le modèle doit la servir, seuls les siens sont nommés', () => {
    expect(() => assertModelServes(KIE, 'z-image', 'web.search', 'kie-ai')).toThrow(
      '« z-image » ne sert pas recherche web (familles détectées : image). Modèles de kie-ai qui la servent : aucun dans le catalogue',
    );
    const searcher: ProviderModel[] = [...KIE, { id: 'sonar', kind: 'chat', kinds: ['chat', 'search'] }];
    expect(() => assertModelServes(searcher, 'sonar', 'web.search', 'autre')).not.toThrow();
    expect(() => assertModelServes(searcher, 'z-image', 'web.search', 'autre')).toThrow(/sonar\.$/u);
  });

  it('la liste des modèles qui servent est bornée à huit', () => {
    const many: ProviderModel[] = [{ id: 'z-image', kind: 'image' }, ...Array.from({ length: 10 }, (_, index) => ({ id: `track-${index}`, kind: 'music' as const }))];
    expect(() => assertModelServes(many, 'z-image', 'music.generate', 'tags')).toThrow(/track-7\.$/u);
    expect(() => assertModelServes(many, 'z-image', 'music.generate', 'tags')).not.toThrow(/track-[89]/u);
  });
});
