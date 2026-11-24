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
    none: 'aucun',
    noChanges: 'Aucune modification à enregistrer',
  },
  modules: {
    enable: 'Activer',
    disable: 'Désactiver',
    requires: 'Dépendances',
    stateOn: 'Actif sur ce serveur',
    stateOff: 'Inactif',
    cascade: 'Cette désactivation entraîne aussi',
  },
  audit: {
    entries: 'entrées',
    date: 'Date',
    action: 'Action',
    actor: 'Acteur',
    details: 'Détails',
    empty: 'Aucune entrée.',
    prev: 'Précédent',
    next: 'Suivant',
  },
  memories: {
    guild: 'Mémoire du serveur',
    members: 'Mémoires des membres',
    empty: 'Vide pour le moment.',
  },
  stats: {
    windowDays: 'derniers jours',
    auditByAction: 'Activité par type (audit)',
    topXp: 'Top XP',
    moderation: 'Modération',
    cases14d: 'Cases sur la période',
    level: 'Niveau',
    count: 'Total',
    empty: 'Pas encore de données.',
  },
  agent: {
    empty: 'Pose ta question : je pilote le serveur avec les mêmes outils que sur Discord.',
    thinking: 'Je réfléchis…',
    placeholder: 'Ta demande pour l\u2019agent…',
    silent: 'Action exécutée, sans réponse.',
    note: 'Mêmes permissions que sur Discord. Les actions destructives demandent une confirmation via le panneau du salon dédié IA.',
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
    none: 'none',
    noChanges: 'No changes to save',
  },
  modules: {
    enable: 'Enable',
    disable: 'Disable',
    requires: 'Requires',
    stateOn: 'Active on this server',
    stateOff: 'Inactive',
    cascade: 'Disabling also turns off',
  },
  audit: {
    entries: 'entries',
    date: 'Date',
    action: 'Action',
    actor: 'Actor',
    details: 'Details',
    empty: 'No entries.',
    prev: 'Previous',
    next: 'Next',
  },
  memories: {
    guild: 'Server memory',
    members: 'Member memories',
    empty: 'Empty for now.',
  },
  stats: {
    windowDays: 'last days',
    auditByAction: 'Activity by type (audit)',
    topXp: 'Top XP',
    moderation: 'Moderation',
    cases14d: 'Cases in window',
    level: 'Level',
    count: 'Total',
    empty: 'No data yet.',
  },
  agent: {
    empty: 'Ask anything: I manage the server with the same tools as on Discord.',
    thinking: 'Thinking…',
    placeholder: 'Your request for the agent…',
    silent: 'Action executed, no reply.',
    note: 'Same permissions as on Discord. Destructive actions require confirmation through the dedicated AI channel panel.',
  },
};

const stored = localStorage.getItem('10cordes-locale');

// Initialisation « fire and forget » : les ressources sont en ligne, la traduction est disponible dès le premier rendu.
void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: stored ?? 'fr',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});

export default i18n;
