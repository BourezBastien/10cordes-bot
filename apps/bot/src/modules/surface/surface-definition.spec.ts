import { describe, expect, it } from 'vitest';
import { SurfaceDefinitionSchema, type SurfaceDefinition } from '@10cordes/shared';
import { applyBindingPatches, findBinding, isBindingPatch, parseBinding } from './surface-definition';

/**
 * Bindings d'une surface : le clic d'un bouton est routé par sa CLÉ. Une
 * recherche ou un patch faux rend un bouton mort ou modifie le mauvais.
 */

const binding = (key: string) => ({ key, label: `Label ${key}`, pipeline: [{ type: 'replyEphemeral', content: `ok ${key}` }] });

function definition(): SurfaceDefinition {
  return SurfaceDefinitionSchema.parse({
    title: 'Sondage',
    rows: [
      { kind: 'buttons', buttons: [binding('oui'), binding('non')] },
      { kind: 'select', select: { options: [binding('choix-a')] } },
    ],
  });
}

describe('findBinding · recherche par clé sur toutes les rangées', () => {
  it('trouve un bouton et une option de menu, jamais par label', () => {
    const def = definition();
    expect(findBinding(def, 'non')?.label).toBe('Label non');
    expect(findBinding(def, 'choix-a')?.label).toBe('Label choix-a');
    expect(findBinding(def, 'Label oui')).toBeNull();
    expect(findBinding(def, 'absent')).toBeNull();
  });
});

describe('isBindingPatch et applyBindingPatches · étapes updateComponent', () => {
  it('reconnaît une étape de patch (clé de binding + patch objet)', () => {
    expect(isBindingPatch({ binding: 'oui', patch: { disabled: true } })).toBe(true);
    expect(isBindingPatch({ binding: 'oui' })).toBe(false);
    expect(isBindingPatch({ patch: { disabled: true } })).toBe(false);
    expect(isBindingPatch({ binding: 'oui', patch: 'texte' })).toBe(false);
    expect(isBindingPatch({ type: 'replyEphemeral' })).toBe(false);
  });

  it('applique les patches aux bons bindings, boutons comme options, et rend vrai', () => {
    const def = definition();
    const changed = applyBindingPatches(def, [
      { binding: 'oui', patch: { disabled: true } },
      { binding: 'choix-a', patch: { label: 'Nouveau' } },
      { binding: 'inconnu', patch: { disabled: true } },
      { type: 'sendMessage' },
    ]);
    expect(changed).toBe(true);
    expect(findBinding(def, 'oui')).toMatchObject({ disabled: true });
    expect(findBinding(def, 'choix-a')).toMatchObject({ label: 'Nouveau' });
    expect(findBinding(def, 'non')).toMatchObject({ disabled: false, label: 'Label non' });
  });

  it('rend faux sans rien toucher quand aucune étape ne correspond', () => {
    const def = definition();
    expect(applyBindingPatches(def, [{ binding: 'rien', patch: { disabled: true } }, { autre: 1 }])).toBe(false);
    expect(findBinding(def, 'oui')?.disabled).toBe(false);
  });
});

describe('parseBinding · validation runtime', () => {
  it('accepte un binding valide en appliquant les défauts, refuse une clé hors kebab-case', () => {
    expect(parseBinding(binding('mon-action'))).toMatchObject({ key: 'mon-action', style: 'primary', disabled: false, access: {} });
    expect(parseBinding(binding('Mauvaise Cle'))).toBeNull();
    expect(parseBinding({ key: 'x' })).toBeNull();
  });
});
