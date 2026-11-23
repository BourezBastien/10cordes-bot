import type { SkillBlueprint } from '@10cordes/shared';
import { chan, dur, emoji, num, str, type DomainBlueprints } from './blueprint.helpers';

/** ÉVÉNEMENTS (14) : RSVP, rappels, événements récurrents, réunions, streams. */
export const eventsBlueprints: DomainBlueprints = [
  {
    slug: 'event-rsvp-list-live',
    domain: 'events',
    tags: ['événement', 'RSVP', 'présent', 'peut-être', 'absent', 'liste live'],
    trigger: 'Organiser un événement avec boutons Présent / Peut-être / Absent',
    params: {
      eventDate: str('Date de l\u0027événement (ISO)', ''),
      reminderMinutes: num('Minutes avant l\u0027événement pour pinger les présents', 15),
    },
    requiredTools: ['surface.create', 'records.create', 'records.search', 'trigger.schedule', 'sendMessage'],
    workflow: '1. Surface avec 3 boutons (Présent / Peut-être / Absent). 2. records.create collection event_rsvps { userId, status } : un par membre, modifiable. 3. Re-render avec la liste des pseudos sous chaque catégorie (live). 4. trigger.schedule 15 min avant : sendMessage ping tous les « Présent ».',
  },
  {
    slug: 'event-schedule-calendar',
    domain: 'events',
    tags: ['événement', 'agenda', 'calendrier', 'planifier', 'date'],
    trigger: 'Planifier un événement unique ou récurrent avec annonce automatique',
    params: {
      title: str('Titre de l\u0027événement', 'Game night'),
      when: str('Date/heure naturelle ou cron (ex : vendredi 21h)', ''),
      announceChannelId: chan('Salon d\u0027annonce'),
    },
    requiredTools: ['event.schedule', 'surface.create', 'trigger.schedule', 'sendMessage'],
    workflow: '1. Convertir la date naturelle en ISO/cron. 2. event.schedule (crée l\u0027événement Discord avec image si fournie). 3. trigger.schedule rappel 1h avant + annonce au démarrage. 4. Surface RSVP liée (voir event-rsvp-list-live).',
  },
  {
    slug: 'meeting-minutes-auto',
    domain: 'events',
    tags: ['réunion', 'compte rendu', 'minutes', 'résumé', 'staff'],
    trigger: 'Compte rendu automatique d\u0027une réunion à sa fin',
    params: {
      channelName: str('Nom du salon/threads de réunion', 'réunion'),
      minutesChannelId: chan('Salon des comptes rendus'),
    },
    requiredTools: ['channel.history.search', 'surface.create', 'sendMessage', 'trigger.schedule'],
    workflow: '1. Marquer le début (records). 2. Au déclencheur de fin (bouton Clôturer la réunion ou heure fixe) : channel.history.search depuis le marqueur. 3. Synthèse structurée (décisions, actions, responsables) via step llm. 4. surface.create du compte rendu + sendMessage du lien.',
  },
  {
    slug: 'event-recurring-weekly',
    domain: 'events',
    tags: ['récurrent', 'hebdomadaire', 'chaque semaine', 'épinglé', 'renouvellement'],
    trigger: 'Événement hebdomadaire avec panneau qui se renouvelle automatiquement',
    params: {
      weekdayCron: str('Cron (ex : vendredis 20h = 0 20 * * 5)', '0 20 * * 5'),
      title: str('Titre', 'Soirée jeux hebdo'),
    },
    requiredTools: ['trigger.schedule', 'surface.create', 'records.create', 'records.update'],
    workflow: '1. trigger.schedule cron weekly. 2. À chaque occurrence : nouvelle surface RSVP (date de la semaine) + archives des réponses précédentes (records.update). 3. Stats de participation cumulées (fidélité).',
  },
  {
    slug: 'stream-live-notify',
    domain: 'events',
    tags: ['stream', 'live', 'notification', 'twitch', 'annonce auto'],
    trigger: 'Annoncer automatiquement quand un membre passe en stream/vocal live',
    params: {
      announceChannelId: chan('Salon d\u0027annonce des streams'),
      roleToPing: str('Rôle à pinguer (optionnel)', ''),
    },
    requiredTools: ['sendMessage', 'surface.create', 'records.create', 'getMemberInfo'],
    workflow: '1. EventTrigger presenceUpdate ou voice (streaming = true). 2. Anti-spam : records.search pour ne pas re-annoncer le même stream. 3. sendMessage avec lien/activité + rôle. 4. Fin du stream : petit récap (durée, participants).',
  },
  {
    slug: 'event-checkin-qr-badge',
    domain: 'events',
    tags: ['check-in', 'présence', 'badge', 'événement IRL', 'émargement'],
    trigger: 'Émargement d\u0027un événement : bouton présent sur place, badges attribués',
    params: {
      badgeRolePrefix: str('Préfixe du rôle badge', 'Badge '),
    },
    requiredTools: ['surface.create', 'records.create', 'createRole', 'addRoleToMember'],
    workflow: '1. Surface « Je suis là ! » (éphémère, ouverte pendant l\u0027événement uniquement). 2. records.create collection event_checkins { userId, eventId, at }. 3. À la clôture : createRole Badge Édition N + addRoleToMember à chaque présent. 4. Collection de badges visible sur le profil (records.search).',
  },
  {
    slug: 'event-countdown-live',
    domain: 'events',
    tags: ['compte à rebours', 'countdown', 'timestamp', 'mise à jour auto'],
    trigger: 'Compte à rebours mis à jour automatiquement jusqu\u0027à un événement',
    params: {
      targetIso: str('Date cible ISO', ''),
      channelId: chan('Salon du compte à rebours'),
      updateCron: str('Rythme de mise à jour', '0 */1 * * *'),
    },
    requiredTools: ['surface.create', 'trigger.schedule', 'surface.patchState'],
    workflow: '1. surface.create avec le timestamp Discord (<t:...:R>) + état jours/heures. 2. trigger.schedule cron updateCron : surface.patchState avec le temps restant. 3. À J-0 : bascule en « C\u0027EST MAINTENANT » + ping.',
  },
  {
    slug: 'event-role-temporary-attendee',
    domain: 'events',
    tags: ['rôle temporaire', 'participant', 'événement', 'retiré après'],
    trigger: 'Rôle Participant attribué à l\u0027inscription et retiré après l\u0027événement',
    params: {
      attendeeRole: str('Nom du rôle participant', 'Participant'),
      cleanupDelay: dur('Délai après l\u0027événement avant retrait', '24h'),
    },
    requiredTools: ['createRole', 'addRoleToMember', 'removeRoleFromMember', 'trigger.schedule', 'records.search'],
    workflow: '1. createRole + binding RSVP « Présent » : addRoleToMember. 2. Après l\u0027événement + cleanupDelay : records.search des participants → removeRoleFromMember pour chacun. 3. Journal de l\u0027attribution/retrait (audit).',
  },
  {
    slug: 'party-queue-rotation',
    domain: 'events',
    tags: ['rotation', 'file', 'équipe', 'lobby', 'tour de jeu'],
    trigger: 'File de rotation pour les parties (lobby plein : les suivants entrent au tour suivant)',
    params: {
      partySize: num('Taille d\u0027une équipe', 5),
    },
    requiredTools: ['surface.create', 'records.create', 'records.update', 'surface.updateComponent', 'sendMessage'],
    workflow: '1. Surface : bouton Entrer dans la file (position live). 2. records.create collection party_queue { userId, position }. 3. Bouton staff « Rotation » : les partySize premiers sortent (jouent), les autres remontent. 4. sendMessage des équipes + updateComponent de la file.',
  },
  {
    slug: 'secret-santa-assign',
    domain: 'events',
    tags: ['secret santa', 'noël', 'cadeau', 'tirage croisé', 'anonymat'],
    trigger: 'Secret Santa : tirage croisé anonyme avec budget et date limite',
    params: {
      budget: str('Budget', '20€'),
      drawDate: str('Date du tirage (naturelle)', ''),
      revealDate: str('Date d\u0027échange', ''),
    },
    requiredTools: ['surface.create', 'records.create', 'records.search', 'sendDirectMessage', 'trigger.schedule'],
    workflow: '1. Surface d\u0027inscription (bouton + acceptation du budget). 2. À drawDate : shuffle croisé sans paires mutuelles + sendDirectMessage de chaque attribution (seul le bot connaît tout). 3. Rappels à J-7/J-1 du revealDate. 4. Liste de souhaits : messages DM relayés anonymement.',
  },
  {
    slug: 'event-feedback-after',
    domain: 'events',
    tags: ['retour', 'feedback', 'après événement', 'note', 'amélioration'],
    trigger: 'Collecter un feedback juste après la fin d\u0027un événement',
    params: {
      hoursAfter: num('Heures après l\u0027événement', 2),
    },
    requiredTools: ['trigger.schedule', 'records.search', 'surface.create', 'records.create'],
    workflow: '1. trigger.schedule hoursAfter l\u0027événement. 2. records.search des présents. 3. DM à chacun : surface note 1-5 + modal commentaires. 4. records.create collection event_feedback + agrégat posté au staff organisateur.',
  },
  {
    slug: 'movie-night-vote-schedule',
    domain: 'events',
    tags: ['film', 'soirée cinéma', 'vote', 'programmation', 'watch party'],
    trigger: 'Soirée film : propositions, vote, puis événement programmé pour le gagnant',
    params: {
      voteDuration: dur('Durée du vote', '24h'),
      watchDay: str('Jour de projection (naturel)', 'samedi 21h'),
    },
    requiredTools: ['surface.create', 'records.create', 'trigger.schedule', 'event.schedule', 'sendMessage'],
    workflow: '1. Surface : bouton Proposer un film + modal (titre, année). 2. Vote 👍 par film (un vote par membre). 3. trigger.schedule à voteDuration : dépouille + event.schedule pour le gagnant à watchDay. 4. sendMessage de la programmation + rappels.',
  },
  {
    slug: 'event-roles-crew-staffing',
    domain: 'events',
    tags: ['staff bénévole', 'crew', 'encadrement', 'créneaux', 'équipe'],
    trigger: 'Recrutement de bénévoles par postes et créneaux pour un événement',
    params: {
      roles: str('Postes au format nom:effectif séparés par virgules', 'Accueil:2, Sécurité:3, Son:1'),
    },
    requiredTools: ['surface.create', 'records.create', 'records.update', 'surface.updateComponent', 'sendDirectMessage'],
    workflow: '1. Surface : un select par poste (places restantes en live). 2. records.create collection crew { userId, role }. 3. Complet : updateComponent (place grisé). 4. Briefing DM à J-1 avec poste, créneau, responsable.',
  },
  {
    slug: 'recurring-community-challenge',
    domain: 'events',
    tags: ['défi', 'challenge', 'créatif', 'thème', 'mensuel', 'votes'],
    trigger: 'Défi créatif récurrent avec thème, soumissions et votes de la communauté',
    params: {
      themeCron: str('Horaire de annonce du thème', '0 18 * * 1'),
      submissionDays: num('Jours de soumission', 10),
      voteDays: num('Jours de vote', 4),
    },
    requiredTools: ['trigger.schedule', 'surface.create', 'records.create', 'records.search', 'records.update', 'sendMessage'],
    workflow: '1. trigger.schedule : annonce du thème (step llm génère un thème original selon l\u0027historique). 2. Fenêtre de soumission : bouton + modal (lien/description). 3. Bascule vote : gallery en surface, un vote par membre. 4. Clôture : podium + records des victoires cumulées.',
  },
];
