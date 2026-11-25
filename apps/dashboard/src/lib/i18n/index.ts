import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { fr } from './fr';
import { en } from './en';

/*
 * LANGUE DE L'INTERFACE. Deux langues, en ligne, sans réseau : le français
 * et l'anglais. Les clés sont typées depuis les ressources françaises : une
 * clé absente est une erreur de compilation, et l'anglais doit avoir la
 * même forme exacte. La langue se choisit (mémorisée), et se change d'un
 * clic dans la coque : `document.documentElement.lang` la suit.
 */

export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const STORAGE_KEY = '10cordes-locale';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof fr };
    returnNull: false;
  }
}

/** Langue mémorisée, sinon celle du navigateur si c'est l'anglais, sinon le français. */
export function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'fr' || stored === 'en') return stored;
    return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
}

const resources = { fr: { translation: fr }, en: { translation: en } };

export function applyLocale(next: Locale): void {
  document.documentElement.lang = next;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale(),
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
  returnNull: false,
});

applyLocale(i18n.language as Locale);

export function currentLocale(): Locale {
  return i18n.language === 'en' ? 'en' : 'fr';
}

export function setLocale(next: Locale): void {
  applyLocale(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Stockage refusé (navigation privée) : la langue tient pour la session.
  }
  void i18n.changeLanguage(next);
}

export function toggleLocale(): void {
  setLocale(currentLocale() === 'fr' ? 'en' : 'fr');
}

export default i18n;
