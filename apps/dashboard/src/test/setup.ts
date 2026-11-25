import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
// La langue s'initialise comme dans main.tsx : toute page rendue la lit.
import '@/lib/i18n';

// Une page rendue sous jsdom (React 19, requêtes simulées) peut dépasser la
// seconde que Testing Library accorde par défaut à une attente quand la
// machine est occupée : les espaces de travail sont testés en parallèle.
configure({ asyncUtilTimeout: 15_000 });

// L'interface est testée en français. La langue se lit AVANT l'initialisation
// d'i18next : les imports sont hissés, le stockage se pose donc ici.
vi.hoisted(() => localStorage.setItem('10cordes-locale', 'fr'));

// Environnement des tests de rendu du dashboard : ce que jsdom n'implémente
// pas et que le système visuel attend. Ces branchements précèdent le chargement
// des modules de test.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Le mouvement réduit se lit avec matchMedia.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Le tiroir (Sheet) s'appuie sur la boîte de dialogue modale native.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
