import type { SkillBlueprint } from '@10cordes/shared';

/**
 * BIBLIOTHÈQUE DE RECETTES officielles (P3.1b) — 42 SkillBlueprint.
 * Chaque recette est une COMPOSITION de primitives génériques
 * (surface.create, records.*, trigger.schedule, tools Discord) : zéro
 * handler métier en dur, tout passe par le moteur générique.
 *
 * Rédaction : workflow déclaratif (étapes numérotées, pas de pseudo-code),
 * params 100 % configurables par le prompt utilisateur, tags multilingues.
 */

const str = (description: string, defaultValue: string, required = false) =>
  ({ type: 'string' as const, description, defaultValue, required });
const num = (description: string, defaultValue: number, required = false) =>
  ({ type: 'number' as const, description, defaultValue, required });
const bool = (description: string, defaultValue: boolean, required = false) =>
  ({ type: 'boolean' as const, description, defaultValue, required });
const dur = (description: string, defaultValue: string, required = false) =>
  ({ type: 'duration' as const, description, defaultValue, required });
const emoji = (description: string, defaultValue: string, required = false) =>
  ({ type: 'emoji' as const, description, defaultValue, required });
const cron = (description: string, defaultValue: string, required = false) =>
  ({ type: 'cron' as const, description, defaultValue, required });
const chan = (description: string, defaultValue = '', required = false) =>
  ({ type: 'channelId' as const, description, defaultValue, required });
const role = (description: string, defaultValue = '', required = false) =>
  ({ type: 'roleId' as const, description, defaultValue, required });

export const BLUEPRINT_LIBRARY: readonly SkillBlueprint[] = [
  // ══════════════════════════════════════════════════════════════
  // TICKETS & SUPPORT (6)
  // ══════════════════════════════════════════════════════════════
  {
    slug: 'tickets-multi-category-escalate',
    domain: 'tickets',
    tags: ['ticket', 'support', 'catégories', 'relancer', 'escalade', '24h', 'bouton rouge vert', 'soporte', 'help desk'],
    trigger: 'Créer un système de tickets multi-catégories avec Claim, Fermer et bouton Relancer évolutif',
    params: {
      categories: str('Liste des catégories de tickets séparées par des virgules', 'Commercial, Technique, Boutique'),
      escalateDelay: dur('Délai avant activation du bouton Relancer si non claim', '24h'),
      escalateEmoji: emoji('Emoji du bouton Relancer', '🔔'),
      initialStyle: str('Couleur initiale du bouton Relancer', 'danger'),
      readyStyle: str('Couleur du bouton Relancer une fois le délai écoulé', 'success'),
      staffRoleId: role('Rôle staff ayant accès aux tickets et mentionné lors de la relance'),
    },
    requiredTools: ['surface.create', 'surface.patchState', 'surface.updateComponent', 'trigger.schedule', 'createChannel', 'deleteChannel', 'sendMessage'],
    workflow: '1. Créer une surface V2 avec un bouton par catégorie (action ouvrant un salon privé). 2. Sur chaque ouverture : salon privé accessible au demandeur et au staff + surface avec état { claimedBy: null, escalated: false } et boutons Claim / Fermer / Relancer (désactivé, style initial). 3. Planifier trigger.schedule (delaySec = escalateDelay, cancelKey = ticket-esc-{{surfaceId}}) avec condition state.claimedBy == null qui exécute updateComponent : bouton Relancer passe au style readyStyle et s\u0027active. 4. Binding Claim : setState claimedBy = actor.id + annuler le trigger. 5. Binding Relancer : mentionner staffRoleId + setState escalated = true. 6. Binding Fermer : supprimer le salon (trigger.schedule différé court).',
  },
  {
    slug: 'tickets-threads-mode',
    domain: 'tickets',
    tags: ['ticket', 'fil', 'thread', 'privé', 'pas de nouveau salon'],
    trigger: 'Système de tickets par fils privés (threads) au lieu de nouveaux salons',
    params: {
      categories: str('Types de tickets séparés par virgules', 'Bug, Question, Signalement'),
      parentChannelId: chan('Salon parent où naissent les threads'),
    },
    requiredTools: ['surface.create', 'thread.create', 'thread.addMember', 'sendMessage'],
    workflow: '1. Surface avec boutons par catégorie. 2. Au clic : thread.create sous le salon parent (privé) + thread.addMember pour le demandeur et le staff. 3. Message d\u0027accueil dans le thread avec Claim / Fermer. 4. Fermer : archiver le thread (pas de suppression).',
  },
  {
    slug: 'tickets-rate-limit',
    domain: 'tickets',
    tags: ['ticket', 'limite', 'maximum', 'spam', 'anti'],
    trigger: 'Limiter le nombre de tickets ouverts simultanément par membre',
    params: {
      maxOpen: num('Nombre maximum de tickets ouverts simultanément par membre', 2),
      denialMessage: str('Message éphémère quand la limite est atteinte', 'Tu as déjà trop de tickets ouverts.'),
    },
    requiredTools: ['surface.create', 'records.create', 'records.search', 'sendMessage'],
    workflow: '1. Au clic d\u0027ouverture : records.search dans la collection tickets (createdBy = actor.id, status = open). 2. Si count >= maxOpen : replyEphemeral avec le denialMessage. 3. Sinon : ouvrir le ticket + records.create { userId, channelId, status: open }. 4. À la fermeture : records.update status = closed.',
  },
  {
    slug: 'tickets-priority-boost',
    domain: 'tickets',
    tags: ['ticket', 'urgent', 'priorité', 'admin', 'remonter'],
    trigger: 'Ajouter un bouton Passer en urgent qui renomme le salon et ping le staff',
    params: {
      urgentEmoji: emoji('Emoji du bouton urgent', '🚨'),
      staffRoleId: role('Rôle pingé en cas d\u0027urgence'),
    },
    requiredTools: ['surface.create', 'renameChannel', 'sendMessage'],
    workflow: '1. Bouton urgent (AccessPolicy permissions Administrator). 2. Au clic : renameChannel avec emoji préfixe + sendMessage mentionnant le staffRoleId dans le salon du ticket. 3. Confirmation éphémère.',
  },
  {
    slug: 'tickets-auto-close-stale',
    domain: 'tickets',
    tags: ['ticket', 'inactif', 'auto-fermeture', '48h', 'rappel'],
    trigger: 'Fermer automatiquement les tickets sans réponse du membre après un délai',
    params: {
      reminderHours: num('Heures avant rappel au membre', 48),
      closeHours: num('Heures après le rappel avant fermeture auto', 24),
    },
    requiredTools: ['trigger.schedule', 'sendMessage', 'records.update'],
    workflow: '1. Après chaque message staff : re-programmer trigger.schedule (delaySec = reminderHours * 3600, cancelKey = stale-{{channelId}}). 2. À l\u0029échéance : sendMessage rappel au membre + second trigger (closeHours). 3. Second trigger : fermer le ticket + archive.',
  },
  {
    slug: 'tickets-feedback-embed',
    domain: 'tickets',
    tags: ['ticket', 'satisfaction', 'note', 'étoiles', 'feedback', 'notation'],
    trigger: 'Demander une note de satisfaction à la fermeture du ticket',
    params: {
      maxStars: num('Nombre d\u0027étoiles', 5),
      logChannelId: chan('Salon où archiver les notes'),
    },
    requiredTools: ['surface.create', 'records.create', 'sendMessage'],
    workflow: '1. À la fermeture : DM avec surface à maxStars boutons. 2. records.create collection ticket_feedback { userId, ticketId, rating }. 3. Résumé mensuel dans le salon de logs.',
  },

  // ══════════════════════════════════════════════════════════════
  // VOCAUX TEMPORAIRES (5)
  // ══════════════════════════════════════════════════════════════
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
    workflow: '1. Créer le hub vocal + EventTrigger sur voice.join (entrée dans le hub). 2. Au join : createChannel vocal avec userLimit + overwrites ManageChannels pour le membre + moveMember + records.create { userId, channelId } dans la collection temp_voices. 3. Panneau de contrôle dans le chat textuel (surface avec boutons Verrouiller, Renommer modal, Limiter modal, Expulser select). 4. EventTrigger voice.leave : si vide, trigger.schedule (delaySec = emptyGraceDelay, cancelKey = voice-del-{{channelId}}) pour supprimer + records.delete. 5. Si rejoint avant l\u0029échéance : trigger.cancelByKey.',
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
    requiredTools: ['createChannel', 'surface.create', 'sendMessage', 'createChannel'],
    workflow: '1. Salon d\u0027attente + bouton Demander à rejoindre. 2. Au clic : DM au propriétaire avec Accepter / Refuser. 3. Accepter : moveMember du demandeur vers le vocal.',
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

  // ══════════════════════════════════════════════════════════════
  // MODÉRATION & ANTI-RAID (6)
  // ══════════════════════════════════════════════════════════════
  {
    slug: 'anti-raid-lockdown',
    domain: 'moderation',
    tags: ['raid', 'lockdown', 'attaque', 'verrouillage', 'anti-raid', '5 joins'],
    trigger: 'Verrouiller automatiquement le serveur en cas de raid (joins massifs)',
    params: {
      joinThreshold: num('Nombre de joins déclencheurs', 5),
      windowSeconds: num('Fenêtre en secondes', 10),
      unlockButton: bool('Afficher un bouton Lever le lockdown au staff', true),
    },
    requiredTools: ['surface.create', 'setChannelOverwrite', 'sendMessage', 'lockdown'],
    workflow: '1. Condition slidingWindow sur member.join (threshold, windowSec). 2. Déclenchement : lockdown + surface d\u0029alerte dans le salon staff avec bouton Lever (AccessPolicy ManageGuild). 3. Levée : unlock + message de retour à la normale.',
  },
  {
    slug: 'anti-spam-message-flood',
    domain: 'moderation',
    tags: ['spam', 'flood', 'messages rapides', 'timeout auto'],
    trigger: 'Anti-spam automatique avec timeout sur flood de messages',
    params: {
      messageThreshold: num('Messages dans la fenêtre', 5),
      windowSeconds: num('Fenêtre en secondes', 4),
      timeoutMinutes: num('Durée du timeout en minutes', 10),
    },
    requiredTools: ['muteMember', 'purgeMessages'],
    workflow: '1. EventTrigger message.create + condition slidingWindow (threshold, windowSec). 2. Déclenchement : deleteMessage des derniers messages + muteMember timeoutMinutes.',
  },
  {
    slug: 'anti-link-whitelist',
    domain: 'moderation',
    tags: ['anti-lien', 'lien', 'whitelist', 'pub', 'invite'],
    trigger: 'Bloquer les liens partout sauf certains salons et rôles',
    params: {
      allowedChannelIds: str('Salons où les liens sont autorisés (IDs séparés par virgules)', ''),
      allowedRoleIds: str('Rôles exemptés (IDs séparés par virgules)', ''),
      warnMessage: str('Message d\u0027avertissement', 'Les liens ne sont pas autorisés ici.'),
    },
    requiredTools: ['purgeMessages', 'sendMessage'],
    workflow: '1. EventTrigger message.create + condition regex https?:// 2. Filtre : salon PAS dans allowedChannelIds ET rôle PAS dans allowedRoleIds. 3. Action : deleteMessage + sendMessage avertissement éphémère.',
  },
  {
    slug: 'warn-escalation-auto',
    domain: 'moderation',
    tags: ['warns', 'escalade', 'timeout', 'kick', 'ban', 'automatique', '3 warns'],
    trigger: 'Escalade automatique des sanctions après N warns sur une période',
    params: {
      timeoutThreshold: num('Warns avant timeout', 3),
      kickThreshold: num('Warns avant kick', 5),
      banThreshold: num('Warns avant ban', 7),
      windowDays: num('Fenêtre en jours', 7),
    },
    requiredTools: ['muteMember', 'kickMember', 'banMember', 'records.create', 'records.search'],
    workflow: '1. Chaque warn : records.create collection warns { userId, reason, at }. 2. Après chaque warn : records.search count dans la fenêtre. 3. Si count >= timeoutThreshold : muteMember 1h. Si >= kickThreshold : kickMember. Si >= banThreshold : banMember.',
  },
  {
    slug: 'anti-ghost-ping',
    domain: 'moderation',
    tags: ['ghost ping', 'mention supprimée', 'anti'],
    trigger: 'Détecter et signaler les ghost pings (mention puis suppression rapide)',
    params: {
      windowSeconds: num('Fenêtre de détection en secondes', 30),
      minMentions: num('Mentions minimum pour déclencher', 1),
    },
    requiredTools: ['sendMessage', 'records.create'],
    workflow: '1. EventTrigger message.create avec minMentions (le moteur cache les mentions TTL 60s). 2. EventTrigger message.delete : si le message caché avait des mentions ET que le délai < windowSeconds. 3. Action : sendMessage dans le salon « X a ghost-ping Y ».',
  },
  {
    slug: 'temp-ban-auto-unban',
    domain: 'moderation',
    tags: ['ban temporaire', 'tempban', 'unban auto', '72h', '3 jours'],
    trigger: 'Bannir temporairement avec unban automatique après le délai',
    params: {
      durationHours: num('Durée du ban en heures', 72),
    },
    requiredTools: ['banMember', 'unbanMember', 'trigger.schedule', 'records.create'],
    workflow: '1. banMember immédiat. 2. trigger.schedule (delaySec = durationHours * 3600, cancelKey = tempban-{{userId}}) avec action unbanMember. 3. records.create collection tempbans { userId, reason, unbanAt }. 4. Survit aux redémarrages (rattrapage garanti).',
  },

  // ══════════════════════════════════════════════════════════════
  // ONBOARDING & VÉRIFICATION (5)
  // ══════════════════════════════════════════════════════════════
  {
    slug: 'verification-math-gate',
    domain: 'onboarding',
    tags: ['vérification', 'captcha', 'math', 'anti-bot', 'je suis humain'],
    trigger: 'Gate de vérification mathématique pour les nouveaux membres',
    params: {
      verifiedRoleId: role('Rôle attribué après vérification'),
      kickMinutes: num('Minutes avant kick si non vérifié', 15),
      maxAttempts: num('Tentatives maximum avant kick', 3),
    },
    requiredTools: ['surface.create', 'addRoleToMember', 'kickMember', 'trigger.schedule', 'records.create'],
    workflow: '1. EventTrigger member.join : DM avec surface « Je suis humain » + modal math (a + b). 2. Vérification : si correct → addRoleToMember + trigger.cancelByKey du kick. 3. Si maxAttempts échoués OU kickMinutes écoulés → kickMember. 4. records.create collection verifications { userId, correctIndex }.',
  },
  {
    slug: 'auto-roles-select-menu',
    domain: 'onboarding',
    tags: ['auto-rôles', 'rôles', 'self-serve', 'menu', 'jeux', 'notifications'],
    trigger: 'Panneau d\u0027auto-rôles avec menus de sélection',
    params: {
      categories: str('Catégories au format titre:liste_de_rôles séparées par point-virgule', 'Jeux:Valorant,Minecraft,LoL; Notifications:Annonces,Giveaways'),
    },
    requiredTools: ['surface.create', 'addRoleToMember', 'removeRoleFromMember'],
    workflow: '1. Pour chaque catégorie : un select menu multi avec les rôles. 2. Au changement : removeRoleFromMember pour les désélectionnés + addRoleToMember pour les nouveaux. 3. Confirmation éphémère avec la liste mise à jour.',
  },
  {
    slug: 'exclusive-color-roles',
    domain: 'onboarding',
    tags: ['couleur', 'rôle couleur', 'exclusif', 'rouge bleu', 'pseudo'],
    trigger: 'Boutons de couleurs de pseudo exclusives (une seule à la fois)',
    params: {
      colors: str('Couleurs au format nom:hex séparées par virgules', 'Rouge:#e74c3c, Bleu:#3498db, Vert:#2ecc71'),
    },
    requiredTools: ['surface.create', 'addRoleToMember', 'removeRoleFromMember', 'createRole'],
    workflow: '1. Créer un rôle par couleur (couleur hex, séparé). 2. Surface avec un bouton par couleur. 3. Au clic : removeRoleFromMember de TOUTES les autres couleurs + addRoleToMember de la nouvelle.',
  },
  {
    slug: 'rules-accept-role',
    domain: 'onboarding',
    tags: ['règlement', 'accepter', 'j\u0027accepte', 'rôle validé', 'conditions'],
    trigger: 'Bouton d\u0027acceptation du règlement qui donne un rôle',
    params: {
      acceptedRoleId: role('Rôle attribué après acceptation'),
      minAccountAgeDays: num('Ancienneté minimum du compte en jours (0 = aucune)', 0),
    },
    requiredTools: ['surface.create', 'addRoleToMember', 'sendMessage'],
    workflow: '1. Surface avec bouton vert « J\u0027accepte le règlement ». 2. AccessPolicy : member.accountAgeDays >= minAccountAgeDays. 3. Au clic : addRoleToMember + confirmation éphémère.',
  },
  {
    slug: 'boost-thank-and-perk',
    domain: 'onboarding',
    tags: ['boost', 'nitro', 'remerciement', 'rôle custom', 'partenaire'],
    trigger: 'Remercier les boosters et leur donner un perk',
    params: {
      announceChannelId: chan('Salon d\u0027annonce des boosts'),
      perkDescription: str('Description du perk offert', 'Création d\u0027un rôle personnalisé (nom + couleur)'),
    },
    requiredTools: ['sendMessage', 'surface.create', 'createRole', 'addRoleToMember'],
    workflow: '1. EventTrigger member.update (rôle booster ajouté). 2. sendMessage dans le salon d\u0029annonces avec remerciement. 3. Surface avec bouton « Créer mon rôle » + modal (nom, couleur hex). 4. createRole + addRoleToMember.',
  },

  // ══════════════════════════════════════════════════════════════
  // FORMULAIRES & CANDIDATURES (5)
  // ══════════════════════════════════════════════════════════════
  {
    slug: 'staff-application-vote',
    domain: 'forms',
    tags: ['candidature', 'recrutement', 'staff', 'modérateur', 'vote', 'pour contre'],
    trigger: 'Système de candidature staff avec vote et décision finale',
    params: {
      formFields: str('Champs du formulaire séparés par virgules', 'Âge, Disponibilités, Expérience, Motivation'),
      voteChannelId: chan('Salon où poster les candidatures'),
      decisionRole: role('Rôle donné au candidat accepté'),
    },
    requiredTools: ['surface.create', 'records.create', 'records.update', 'addRoleToMember', 'sendMessage'],
    workflow: '1. Surface avec bouton « Postuler » + modal (formFields). 2. records.create collection applications { userId, ...formData }. 3. Post dans voteChannelId : surface avec Pour (compteur) / Contre (compteur) / Décision finale (admin only). 4. Accepter : addRoleToMember + DM félicitations + verrouiller les boutons de vote. 5. Refuser : DM + refus 14 jours (records).',
  },
  {
    slug: 'suggestion-vote-staff',
    domain: 'forms',
    tags: ['suggestion', 'idée', 'boîte à idées', 'staff', 'approuver refuser'],
    trigger: 'Boîte à idées avec votes publics et statut staff',
    params: {
      channelStaffId: chan('Salon staff pour trier'),
    },
    requiredTools: ['surface.create', 'records.create', 'records.update'],
    workflow: '1. Surface avec bouton « Proposer une idée » + modal (Titre, Description). 2. Post public : 👍/👎 avec compteurs live. 3. Boutons staff (AccessPolicy ManageGuild) : Approuver / Refuser + modal raison. 4. records.update status + embed mis à jour.',
  },
  {
    slug: 'bug-report-tracking',
    domain: 'forms',
    tags: ['bug', 'signaler', 'issue', 'statut', 'ouvert corrigé'],
    trigger: 'Système de signalement de bugs avec suivi de statut',
    params: {
      bugChannelId: chan('Salon des bugs'),
      statuses: str('Statuts possibles', 'Ouvert, En cours, Corrigé'),
    },
    requiredTools: ['surface.create', 'records.create', 'records.update'],
    workflow: '1. Bouton Signaler + modal (Version, Étapes, Sévérité). 2. Post dans bugChannelId avec select menu de statut (AccessPolicy devs). 3. records.create collection bugs { reporterId, ...fields, status }. 4. Changement de statut : records.update + embed couleur mise à jour.',
  },
  {
    slug: 'tournament-bracket',
    domain: 'forms',
    tags: ['tournoi', 'bracket', '8 joueurs', 'élimination', 'vainqueur'],
    trigger: 'Tournoi à élimination directe avec bracket de N joueurs',
    params: {
      playerCount: num('Nombre de joueurs (puissance de 2)', 8),
      gameName: str('Nom du jeu', 'À définir'),
    },
    requiredTools: ['surface.create', 'records.create', 'records.update', 'surface.updateComponent'],
    workflow: '1. Inscription : bouton + modal (pseudo en jeu, rang). 2. records.create collection tournament_players. 3. Surface bracket : N/2 matchs avec boutons « Déclarer vainqueur » par joueur. 4. Chaque victoire : updateComponent du match suivant avec le gagnant. 5. records.update pour suivre les rounds.',
  },
  {
    slug: 'anonymous-confession',
    domain: 'forms',
    tags: ['confession', 'anonyme', 'secret', 'compte à rebours'],
    trigger: 'Confessions anonymes avec traçabilité staff',
    params: {
      confessionChannelId: chan('Salon public des confessions'),
      staffLogChannelId: chan('Salon staff avec l\u0027identité réelle'),
    },
    requiredTools: ['surface.create', 'webhook.post', 'records.create'],
    workflow: '1. Bouton Se confesser + modal (texte). 2. webhook.post anonyme dans le salon public. 3. records.create collection confessions { realUserId, text } — l\u0027identité reste en DB pour la modération.',
  },

  // ══════════════════════════════════════════════════════════════
  // ENGAGEMENT & JEUX (6)
  // ══════════════════════════════════════════════════════════════
  {
    slug: 'poll-multi-choice-timed',
    domain: 'engagement',
    tags: ['sondage', 'vote', 'scrutin', 'boutons', 'clôture auto', 'pourcentages'],
    trigger: 'Sondage avec boutons, un vote modifiable par personne, clôture automatique',
    params: {
      closeDelay: dur('Délai avant clôture automatique', '2h'),
      options: str('Options séparées par virgules', 'Option A, Option B, Option C'),
    },
    requiredTools: ['surface.create', 'records.create', 'records.search', 'trigger.schedule', 'surface.updateComponent'],
    workflow: '1. Surface avec un bouton par option (action record.write dans component_votes). 2. Chaque vote modifiable (records.search par messageId + userId, records.update si existant). 3. trigger.schedule à closeDelay avec runTool records.search (collection component_votes, filtre messageId) pour dépouiller. 4. Clôture : surface.patchState (state.closed = true, affiche pourcentages, barres, gagnant) + surface.updateComponent pour désactiver chaque bouton.',
  },
  {
    slug: 'giveaway-reaction-random',
    domain: 'engagement',
    tags: ['giveaway', 'concours', 'nitro', 'tirage', 'gagnant', 'aléatoire'],
    trigger: 'Giveaway avec bouton Participer et tirage aléatoire à l\u0029échéance',
    params: {
      prize: str('Lot à gagner', '1 mois de Nitro'),
      duration: dur('Durée du giveaway', '24h'),
      winnerCount: num('Nombre de gagnants', 1),
      requiredRoleId: role('Rôle requis pour participer (optionnel)'),
      boosterBonus: bool('Les boosters ont 2 chances', false),
    },
    requiredTools: ['surface.create', 'records.create', 'records.search', 'trigger.schedule', 'members.pickRandom', 'sendMessage'],
    workflow: '1. Surface « 🎉 Giveaway » avec bouton Participer + compteur live. 2. records.create collection giveaway_entries { userId } (AccessPolicy : requiredRoleId si défini). 3. trigger.schedule à duration avec : members.pickRandom parmi les participants. 4. sendMessage annonce du gagnant + surface.updateComponent bouton désactivé « Terminé ». 5. Bouton Reroll (admin) pour retirer.',
  },
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
    workflow: '1. Surface avec 3 boutons (Présent / Peut-être / Absent). 2. records.create collection event_rsvps { userId, status } — un par membre, modifiable. 3. Re-render avec la liste des pseudos sous chaque catégorie (live). 4. trigger.schedule 15 min avant : sendMessage ping tous les « Présent ».',
  },
  {
    slug: 'counting-game',
    domain: 'engagement',
    tags: ['compter', 'jeu', '1 2 3', 'compteur', 'record', 'chaîne'],
    trigger: 'Jeu de comptage où les membres comptent sans double-post',
    params: {
      channelId: chan('Salon du jeu de comptage'),
      resetOnError: bool('Remettre à 0 en cas d\u0027erreur', true),
    },
    requiredTools: ['surface.create', 'records.create', 'records.update', 'records.search', 'sendMessage'],
    workflow: '1. EventTrigger message.create dans le salon. 2. Vérifier : le nombre est == state.lastCount + 1 ET le membre != state.lastUserId. 3. Correct : setState lastCount++ + lastUserId. 4. Incorrect : reaction.add ❌ + annonce du record + reset si demandé.',
  },
  {
    slug: 'treasure-chest-first-click',
    domain: 'engagement',
    tags: ['coffre', 'trésor', 'premier clic', 'gagnant', 'apparaît', '100 pièces'],
    trigger: 'Coffre au trésor qui apparaît périodiquement, premier clic gagne',
    params: {
      intervalHours: num('Heures entre chaque apparition', 2),
      prize: str('Lot du coffre', '100 pièces'),
    },
    requiredTools: ['surface.create', 'trigger.schedule', 'records.create', 'records.create', 'sendMessage'],
    workflow: '1. trigger.schedule interval : surface.create avec bouton « Ouvrir le coffre ». 2. Pipeline du bouton : step claimOnce (SET NX — exactement un gagnant). 3. Si gagné : sendMessage annonce + records.create collection prizes { userId, prize }. 4. updateComponent : bouton désactivé affichant le gagnant.',
  },
  {
    slug: 'daily-streak-pointer',
    domain: 'engagement',
    tags: ['daily', 'streak', 'pointer', 'série', 'jours consécutifs', 'bonus'],
    trigger: 'Système de streak quotidien avec bouton Pointer',
    params: {
      channelId: chan('Salon du daily'),
      streakResetHours: num('Heures sans pointage avant reset de la série', 48),
    },
    requiredTools: ['surface.create', 'records.create', 'records.update', 'records.search', 'trigger.schedule'],
    workflow: '1. Surface permanente avec bouton Pointer. 2. records.search collection streaks { userId, count, lastAt }. 3. Si lastAt < streakResetHours : count++. Sinon : count = 1. 4. records.update + confirmation avec la série actuelle.',
  },

  // ══════════════════════════════════════════════════════════════
  // AUTOMATISATION & TIMERS (5)
  // ══════════════════════════════════════════════════════════════
  {
    slug: 'auto-recurring-digest',
    domain: 'automation',
    tags: ['message récurrent', 'cron', 'rappel planifié', 'bilan automatique', 'digest'],
    trigger: 'Planifier un message, rappel ou bilan récurrent personnalisable',
    params: {
      cronSchedule: cron('Expression cron (ex : lundis 9h = 0 9 * * 1)', '0 9 * * 1'),
      targetChannelId: chan('Salon où publier'),
      headerEmoji: emoji('Emoji d\u0027en-tête', '📅'),
      includeActivitySummary: bool('Inclure les stats d\u0029activité récentes', false),
      messagePrompt: str('Consigne du message récurrent', 'Bonne semaine à tous ! Quels sont vos objectifs ?'),
    },
    requiredTools: ['trigger.schedule', 'surface.create', 'sendMessage', 'activity.summary'],
    workflow: '1. Convertir l\u0029horaire en cron si besoin. 2. trigger.schedule kind=cron. 3. À chaque exécution : si includeActivitySummary, appeler activity.summary puis composer le contenu. 4. Publier via surface.create (Components V2) avec headerEmoji.',
  },
  {
    slug: 'auto-night-mode-schedule',
    domain: 'automation',
    tags: ['mode nuit', 'fermer salon', 'ouvrir salon', 'schedule', 'automatique'],
    trigger: 'Fermer et ouvrir des salons automatiquement à des horaires fixes',
    params: {
      closeCron: cron('Horaire de fermeture (ex : 2h du matin = 0 2 * * *)', '0 2 * * *'),
      openCron: cron('Horaire d\u0029ouverture (ex : 7h du matin = 0 7 * * *)', '0 7 * * *'),
      channelIds: str('Salons à fermer/ouvrir (IDs séparés par virgules)', ''),
    },
    requiredTools: ['trigger.schedule', 'setChannelOverwrite'],
    workflow: '1. trigger.schedule cron closeCron : setChannelOverwrite deny SendMessages pour @everyone sur chaque salon. 2. trigger.schedule cron openCron : retire le deny.',
  },
  {
    slug: 'auto-sticky-message',
    domain: 'automation',
    tags: ['message sticky', 'rappel', 'toujours visible', 'repost', '5 messages'],
    trigger: 'Message sticky qui se repost après N nouveaux messages',
    params: {
      channelId: chan('Salon du sticky'),
      message: str('Contenu du message sticky', ''),
      repostAfter: num('Reposter après N nouveaux messages', 5),
    },
    requiredTools: ['sendMessage', 'purgeMessages', 'records.create', 'records.update', 'surface.create'],
    workflow: '1. records.create collection sticky_state { channelId, messageId, count: 0 }. 2. EventTrigger message.create dans le salon : increment count. 3. Si count >= repostAfter : deleteMessage de l\u0029ancien + sendMessage du nouveau + reset count.',
  },
  {
    slug: 'auto-idle-topic-prompts',
    domain: 'automation',
    tags: ['inactivité', 'silence', 'sujet aléatoire', 'relancer', 'ambiance'],
    trigger: 'Envoyer un sujet de discussion quand un salon devient inactif',
    params: {
      channelId: chan('Salon à surveiller'),
      idleMinutes: num('Minutes d\u0029inactivité avant relance', 10),
    },
    requiredTools: ['trigger.schedule', 'trigger.cancelByKey', 'sendMessage', 'sendMessage'],
    workflow: '1. EventTrigger message.create : trigger.cancelByKey idle-{{channelId}} + trigger.schedule (delaySec = idleMinutes * 60, cancelKey = idle-{{channelId}}). 2. À l\u0029échéance : step random pour choisir un sujet + sendMessage.',
  },
  {
    slug: 'auto-weekly-staff-report',
    domain: 'monitoring',
    tags: ['rapport hebdo', 'dimanche', 'staff', 'nouveaux membres', 'tickets', 'sanctions'],
    trigger: 'Résumé hebdomadaire automatique pour le staff',
    params: {
      staffChannelId: chan('Salon staff où poster'),
      cronSchedule: cron('Horaire (ex : dimanches 20h = 0 20 * * 0)', '0 20 * * 0'),
    },
    requiredTools: ['trigger.schedule', 'surface.create', 'activity.summary', 'sendMessage'],
    workflow: '1. trigger.schedule cron. 2. À l\u0029exécution : activity.summary (7 jours) + records.search sur tickets fermés + sanctions. 3. Publier un panneau V2 structuré dans le salon staff.',
  },

  // ══════════════════════════════════════════════════════════════
  // MONITORING & STATS (4)
  // ══════════════════════════════════════════════════════════════
  {
    slug: 'game-server-status-board',
    domain: 'monitoring',
    tags: ['serveur jeu', 'FiveM', 'Minecraft', 'statut', 'en ligne', 'hors ligne'],
    trigger: 'Tableau de bord du statut de serveurs de jeu (ping périodique)',
    params: {
      servers: str('Serveurs au format jeu:host séparés par virgules', 'minecraft:play.example.com, fivem:rp.example.com'),
      refreshMinutes: num('Minutes entre chaque ping', 5),
    },
    requiredTools: ['surface.create', 'trigger.schedule', 'surface.updateComponent', 'server.status'],
    workflow: '1. surface.create avec un TextDisplay par serveur. 2. trigger.schedule interval refreshMinutes : server.status pour chaque serveur + surface.updateComponent (🟢/🔴 + joueurs).',
  },
  {
    slug: 'member-count-channel',
    domain: 'monitoring',
    tags: ['compteur membres', 'salon vocal', 'mise à jour auto', 'statistiques'],
    trigger: 'Salon vocal qui affiche le nombre de membres et se met à jour',
    params: {
      format: str('Format du nom ({{count}} remplacé)', '👥 Membres : {{count}}'),
      refreshMinutes: num('Minutes entre chaque mise à jour', 10),
    },
    requiredTools: ['createChannel', 'renameChannel', 'trigger.schedule'],
    workflow: '1. createChannel vocal verrouillé avec le format initial. 2. trigger.schedule interval refreshMinutes : renameChannel avec le count actualisé (rate-limit Discord 2/10min respecté).',
  },
  {
    slug: 'top-players-leaderboard-refresh',
    domain: 'monitoring',
    tags: ['classement', 'leaderboard', 'top', 'XP', 'activité', 'rafraîchit'],
    trigger: 'Classement des membres les plus actifs qui se met à jour automatiquement',
    params: {
      leaderboardChannelId: chan('Salon du classement'),
      refreshHours: num('Heures entre chaque rafraîchissement', 1),
      topCount: num('Nombre de membres affichés', 10),
    },
    requiredTools: ['surface.create', 'trigger.schedule', 'activity.summary', 'surface.updateComponent'],
    workflow: '1. surface.create avec le classement initial (activity.summary). 2. trigger.schedule interval refreshHours : re-appeler activity.summary + surface.updateComponent avec les nouvelles positions.',
  },
  {
    slug: 'role-admin-alert',
    domain: 'monitoring',
    tags: ['rôle admin', 'alerte', 'permission Administrator', 'sécurité'],
    trigger: 'Alerte immédiate quand quelqu\u0027obtient un rôle avec la permission Administrateur',
    params: {
      ownerId: str('ID du propriétaire à alerter', ''),
    },
    requiredTools: ['sendMessage', 'sendDirectMessage'],
    workflow: '1. EventTrigger member.update (roleId avec Administrator). 2. sendDirectMessage au owner avec le nom du membre et le rôle. 3. sendMessage rouge dans un salon staff.',
  },

  // ══════════════════════════════════════════════════════════════
  // COMMUNAUTÉ (5)
  // ══════════════════════════════════════════════════════════════
  {
    slug: 'birthday-role-timed',
    domain: 'community',
    tags: ['anniversaire', 'rôle temporaire', '24h', 'retire auto'],
    trigger: 'Anniversaires avec rôle temporaire retiré automatiquement après 24h',
    params: {
      announceCron: cron('Horaire d\u0029annonce quotidien (ex : 8h = 0 8 * * *)', '0 8 * * *'),
      birthdayRoleId: role('Rôle anniversaire à donner/retirer'),
      announceChannelId: chan('Salon des annonces'),
    },
    requiredTools: ['records.create', 'records.search', 'trigger.schedule', 'addRoleToMember', 'removeRoleFromMember', 'sendMessage'],
    workflow: '1. records.create collection birthdays { userId, dateMMDD }. 2. trigger.schedule cron : records.search dateMMDD == aujourd\u0027hui. 3. sendMessage souhait + addRoleToMember. 4. trigger.schedule 24h : removeRoleFromMember.',
  },
  {
    slug: 'reputation-thank-system',
    domain: 'community',
    tags: ['réputation', 'merci', 'entraide', 'point', '+1'],
    trigger: 'Système de réputation quand quelqu\u0027un dit merci à un autre',
    params: {
      cooldownMinutes: num('Minutes minimum entre deux remerciements des mêmes personnes', 60),
    },
    requiredTools: ['records.create', 'records.search', 'sendMessage'],
    workflow: '1. EventTrigger message.create regex merci.*<@\\d+>. 2. Extraire le membre mentionné. 3. records.search collection reputation (from, to, windowSec cooldown). 4. Si pas récent : records.create + reaction.add ❤️.',
  },
  {
    slug: 'afk-status-mention-notify',
    domain: 'community',
    tags: ['AFK', 'absent', 'mention', 'préviens', 'retour'],
    trigger: 'Système AFK : prévenir quand on mentionne quelqu\u0027un d\u0027absent',
    params: {},
    requiredTools: ['records.create', 'records.search', 'records.delete', 'sendMessage'],
    workflow: '1. « Je suis AFK (raison) » : records.create collection afk { userId, reason, since }. 2. EventTrigger message.create avec mentions : records.search afk pour chaque mentionné → sendMessage « X est AFK : raison, depuis Y min ». 3. Le retour de l\u0027AFK (message de l\u0027AFK) : records.delete.',
  },
  {
    slug: 'crosspost-announcements',
    domain: 'automation',
    tags: ['crosspost', 'publier', 'annonces', 'auto', 'abonnés'],
    trigger: 'Crossposter automatiquement les messages du salon d\u0027annonces',
    params: {
      announceChannelId: chan('Salon d\u0027annonces (type News)'),
    },
    requiredTools: ['message.crosspost'],
    workflow: '1. EventTrigger message.create dans le salon d\u0027annonces. 2. Si l\u0029auteur est staff ou le bot : message.crosspost.',
  },
  {
    slug: 'level-reward-milestones',
    domain: 'community',
    tags: ['niveau', 'level', 'récompense', 'rôle', 'palier', '5 10 15'],
    trigger: 'Rôles-récompenses automatiques à des paliers de niveau',
    params: {
      milestones: str('Paliers au format niveau:rôleId séparés par virgules', '5:rôle-actif-id, 15:rôle-vétéran-id'),
    },
    requiredTools: ['addRoleToMember', 'records.create', 'records.search', 'sendMessage'],
    workflow: '1. Records de niveaux (collection levels). 2. EventTrigger ou check après chaque gain d\u0029XP : records.search niveau actuel. 3. Si un palier est franchi : addRoleToMember + sendMessage annonce.',
  },
];
