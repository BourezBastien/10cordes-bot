import type { SkillBlueprint } from '@10cordes/shared';
import { bool, dur, emoji, num, str, type DomainBlueprints } from './blueprint.helpers';

/** VOCAUX TEMPORAIRES (13) : générateurs, contrôle, permissions, stats. */
export const voiceBlueprints: DomainBlueprints = [
  {
    slug: 'temp-voice-grace-delay',
    domain: 'voice',
    tags: ['vocal temporaire', 'temp voice', 'join to create', 'créer un vocal', 'délai suppression', 'salon privé'],
    trigger: 'Salons vocaux temporaires auto-gérés avec délai de grâce avant suppression',
    params: {
      hubName: str('Nom du salon vocal générateur', '➕ Créer un vocal'),
      channelNameTemplate: str('Modèle de nom (supporte {{actor.username}})', 'Salon de {{actor.username}}'),
      defaultUserLimit: num('Limite de places par défaut (0 = illimité)', 0),
      emptyGraceDelay: dur('Délai avant suppression d\u0027un vocal vide', '15s'),
      controlEmoji: emoji('Emoji du panneau de contrôle vocal', '🎙️'),
    },
    requiredTools: ['createChannel', 'deleteChannel', 'renameChannel', 'setChannelOverwrite', 'surface.create', 'surface.patchState', 'trigger.schedule', 'trigger.cancelByKey', 'records.create', 'records.delete'],
    workflow: '1. Créer le hub vocal + EventTrigger sur voice.join (entrée dans le hub). 2. Au join : createChannel vocal avec userLimit + overwrites ManageChannels pour le membre + moveMember + records.create { userId, channelId } dans la collection temp_voices. 3. Panneau de contrôle dans le chat textuel (surface avec boutons Verrouiller, Renommer modal, Limiter modal, Expulser select). 4. EventTrigger voice.leave : si vide, trigger.schedule (delaySec = emptyGraceDelay, cancelKey = voice-del-{{channelId}}) pour supprimer + records.delete. 5. Si rejoint avant l\u0027échéance : trigger.cancelByKey.',
  },
  {
    slug: 'temp-voice-duo-squad',
    domain: 'voice',
    tags: ['générateur', 'duo', 'squad', 'limite', '2 places', '5 places'],
    trigger: 'Plusieurs générateurs vocaux avec limites différentes (Duo, Squad...)',
    params: {
      generators: str('Liste des générateurs au format nom:limite séparés par virgules', '🎮 Duo:2, 🔥 Squad:5'),
    },
    requiredTools: ['createChannel', 'deleteChannel', 'surface.create', 'trigger.schedule', 'trigger.cancelByKey', 'records.create'],
    workflow: '1. Pour chaque générateur : createChannel vocal avec userLimit correspondant. 2. EventTrigger voice.join sur chaque hub. 3. Même mécanique que temp-voice-grace-delay (création, panneau, suppression avec délai).',
  },
  {
    slug: 'temp-voice-claim',
    domain: 'voice',
    tags: ['vocal', 'propriétaire', 'claim', 'créateur parti', 'reprendre'],
    trigger: 'Permettre à quiconque de réclamer un vocal dont le créateur est parti',
    params: {
      claimEmoji: emoji('Emoji du bouton réclamer', '👑'),
    },
    requiredTools: ['surface.create', 'surface.patchState', 'setChannelOverwrite', 'renameChannel'],
    workflow: '1. Panneau avec bouton Réclamer (condition : state.ownerId pas dans le vocal). 2. Au clic : setChannelOverwrite ManageChannels pour le nouveau propriétaire + renameChannel avec son pseudo. 3. setState ownerId = actor.id.',
  },
  {
    slug: 'temp-voice-request-join',
    domain: 'voice',
    tags: ['vocal', 'verrouillé', 'demander à rejoindre', 'accepter refuser', 'salle d\u0027attente'],
    trigger: 'Système de demande d\u0027accès aux vocaux verrouillés',
    params: {
      waitChannelName: str('Nom du salon d\u0027attente', 'Salle d\u0027attente'),
    },
    requiredTools: ['createChannel', 'surface.create', 'sendMessage', 'sendDirectMessage'],
    workflow: '1. Salon d\u0027attente + bouton Demander à rejoindre. 2. Au clic : sendDirectMessage au propriétaire avec Accepter / Refuser. 3. Accepter : moveMember du demandeur vers le vocal.',
  },
  {
    slug: 'temp-voice-mute-all',
    domain: 'voice',
    tags: ['vocal', 'mute', 'briefing', 'tout le monde', 'sauf moi'],
    trigger: 'Bouton pour muter tout le monde sauf le créateur pendant un briefing',
    params: {},
    requiredTools: ['surface.create', 'setChannelOverwrite'],
    workflow: '1. Bouton Mode Briefing (AccessPolicy : state.ownerId == actor.id). 2. Au clic : setChannelOverwrite MuteMembers pour @everyone sauf le propriétaire. 3. Re-clic : retire la contrainte.',
  },
  {
    slug: 'temp-voice-user-limit-modal',
    domain: 'voice',
    tags: ['vocal', 'limite', 'places', 'modal', '0 à 99'],
    trigger: 'Bouton pour changer la limite de places du vocal via modal',
    params: {},
    requiredTools: ['surface.create', 'records.update'],
    workflow: '1. Bouton Limiter (owner only) + modal (nombre 0-99). 2. Validation : entier 0-99 sinon erreur actionnable. 3. Application via step updateChannel userLimit + setState limit.',
  },
  {
    slug: 'temp-voice-rename-modal',
    domain: 'voice',
    tags: ['vocal', 'renommer', 'modal', 'nom personnalisé'],
    trigger: 'Bouton pour renommer son vocal via modal',
    params: {
      maxLength: num('Longueur maximum du nom', 32),
    },
    requiredTools: ['surface.create', 'renameChannel'],
    workflow: '1. Bouton Renommer (owner only) + modal texte (maxLength). 2. renameChannel. 3. Filtrage : caractères interdits Discord nettoyés.',
  },
  {
    slug: 'temp-voice-kick-select',
    domain: 'voice',
    tags: ['vocal', 'expulser', 'kick', 'select', 'membres du salon'],
    trigger: 'Bouton pour expulser un membre du vocal via menu de sélection',
    params: {},
    requiredTools: ['surface.create', 'records.search', 'deleteMessage'],
    workflow: '1. Bouton Expulser (owner only) : ouvre un select des membres présents (voix). 2. Au choix : disconnect du vocal + confirmation éphémère. 3. L\u0027expulsé peut redemander l\u0027accès via le système de demande.',
  },
  {
    slug: 'temp-voice-lock-unlock',
    domain: 'voice',
    tags: ['vocal', 'verrouiller', 'déverrouiller', 'cadenas', 'privé'],
    trigger: 'Bouton cadenas pour verrouiller/déverrouiller son vocal',
    params: {
      lockEmoji: emoji('Emoji du bouton verrouiller', '🔒'),
    },
    requiredTools: ['surface.create', 'setChannelOverwrite', 'surface.updateComponent'],
    workflow: '1. Bouton Verrouiller (owner only). 2. setChannelOverwrite Connect deny pour @everyone. 3. updateComponent : emoji passe à 🔓, label Déverrouiller. 4. Re-clic : retire le deny.',
  },
  {
    slug: 'temp-voice-auto-region',
    domain: 'voice',
    tags: ['vocal', 'région', 'ping', 'auto', 'routing'],
    trigger: 'Optimiser automatiquement la région du serveur vocal selon les participants',
    params: {
      checkMinutes: num('Minutes entre chaque vérification', 5),
    },
    requiredTools: ['trigger.schedule', 'records.search'],
    workflow: '1. trigger.schedule interval sur les vocaux actifs. 2. Lecture de la moyenne de ping des participants (voice activity). 3. Si dégradation : changement de région automatique + note dans le panneau.',
  },
  {
    slug: 'voice-activity-leaderboard',
    domain: 'voice',
    tags: ['vocal', 'activité', 'heures', 'classement', 'temps de parole'],
    trigger: 'Classement du temps passé en vocal, mis à jour automatiquement',
    params: {
      boardChannelId: str('Salon du classement', ''),
      refreshHours: num('Heures entre chaque rafraîchissement', 6),
      topCount: num('Nombre de membres affichés', 10),
    },
    requiredTools: ['voice.activity', 'surface.create', 'trigger.schedule', 'surface.updateComponent'],
    workflow: '1. voice.activity (top N par temps cumulé). 2. surface.create classement V2. 3. trigger.schedule interval refreshHours : re-fetch + surface.updateComponent des positions (médailles 🥇🥈🥉).',
  },
  {
    slug: 'voice-recording-announce',
    domain: 'voice',
    tags: ['vocal', 'enregistrement', 'annonce', 'consentement', 'RGPD'],
    trigger: 'Annonce obligatoire quand un salon vocal passe en mode enregistrement',
    params: {
      announceTemplate: str('Message d\u0027annonce', '⚠️ Ce vocal est maintenant ENREGISTRÉ'),
    },
    requiredTools: ['surface.create', 'sendMessage', 'records.create'],
    workflow: '1. EventTrigger voiceChannelUpdate (région auto → mode enregistrement). 2. sendMessage announceTemplate dans le salon lié + ping des présents. 3. records.create collection voice_records { channelId, startedAt } (traçabilité).',
  },
  {
    slug: 'temp-voice-template-categories',
    domain: 'voice',
    tags: ['vocal', 'template', 'catégorie', 'gabarit', 'permissions héritées'],
    trigger: 'Vocaux temporaires créés avec des gabarits de permissions prédéfinis',
    params: {
      templates: str('Gabarits au format nom:permissions séparées par virgules', 'Privé:owner-only, Team:staff+owner, Public:everyone'),
    },
    requiredTools: ['createChannel', 'setChannelOverwrite', 'surface.create'],
    workflow: '1. Surface de création avec un bouton par gabarit. 2. createChannel hérite la catégorie cible. 3. setChannelOverwrite selon le gabarit choisi (Privé = deny @everyone). 4. Le panneau de contrôle permet de changer de gabarit à chaud.',
  },
];
