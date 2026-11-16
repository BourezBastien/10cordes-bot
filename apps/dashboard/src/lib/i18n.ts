import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const fr = {
  nav: {
    guilds: 'Serveurs',
    home: 'Aperçu',
    config: 'Configuration',
    modules: 'Modules',
    audit: 'Audit',
    memories: 'Mémoires',
    stats: 'Statistiques',
    agent: 'Agent',
    logout: 'Déconnexion',
  },
  login: {
    title: '10cordes',
    subtitle: 'Le pilote Discord de ton serveur',
    button: 'Se connecter avec Discord',
  },
  guilds: {
    title: 'Tes serveurs',
    empty: 'Aucun serveur gérable trouvé. Invite le bot pour commencer.',
    members: 'membres',
  },
  common: {
    loading: 'Chargement…',
    error: 'Une erreur est survenue',
    save: 'Enregistrer',
    saved: 'Enregistré',
    cancel: 'Annuler',
    back: 'Retour',
  },
};

const en = {
  nav: {
    guilds: 'Servers',
    home: 'Overview',
    config: 'Configuration',
    modules: 'Modules',
    audit: 'Audit',
    memories: 'Memories',
    stats: 'Statistics',
    agent: 'Agent',
    logout: 'Sign out',
  },
  login: {
    title: '10cordes',
    subtitle: 'The Discord pilot for your server',
    button: 'Sign in with Discord',
  },
  guilds: {
    title: 'Your servers',
    empty: 'No manageable server found. Invite the bot to get started.',
    members: 'members',
  },
  common: {
    loading: 'Loading…',
    error: 'Something went wrong',
    save: 'Save',
    saved: 'Saved',
    cancel: 'Cancel',
    back: 'Back',
  },
};

const stored = localStorage.getItem('10cordes-locale');

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: stored ?? 'fr',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});

export default i18n;
