import { chan, num, role, str, type DomainBlueprints } from './blueprint.helpers';

/** ONBOARDING & VÉRIFICATION (13) : gates, rôles, acceptation, boost, retour. */
export const onboardingBlueprints: DomainBlueprints = [
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
    workflow: '1. EventTrigger member.update (rôle booster ajouté). 2. sendMessage dans le salon d\u0027annonces avec remerciement. 3. Surface avec bouton « Créer mon rôle » + modal (nom, couleur hex). 4. createRole + addRoleToMember.',
  },
  {
    slug: 'welcome-card-canvas',
    domain: 'onboarding',
    tags: ['bienvenue', 'carte', 'image', 'canvas', 'banner', 'nouveau membre'],
    trigger: 'Message de bienvenue avec carte image personnalisée',
    params: {
      welcomeChannelId: chan('Salon des bienvenues'),
      template: str('Texte (variables {{user.mention}}, {{server.name}}, {{member.count}})', 'Bienvenue {{user.mention}} ! Tu es le membre n°{{member.count}}'),
      bgUrl: str('URL de l\u0027image de fond', ''),
    },
    requiredTools: ['image.compose', 'sendMessage', 'getMemberInfo'],
    workflow: '1. EventTrigger member.join. 2. getMemberInfo (avatar, name). 3. image.compose (canvas : fond, avatar arrondi, texte). 4. sendMessage avec le fichier + template rendu.',
  },
  {
    slug: 'goodbye-message',
    domain: 'onboarding',
    tags: ['départ', 'goodbye', 'quit', 'au revoir', 'stats'],
    trigger: 'Message de départ discret quand un membre quitte',
    params: {
      leaveChannelId: chan('Salon des départs'),
      template: str('Texte ({{user.username}}, {{member.count}}, {{joinedDaysAgo}})', '{{user.username}} nous a quittés après {{joinedDaysAgo}} jours'),
    },
    requiredTools: ['sendMessage', 'getMemberInfo'],
    workflow: '1. EventTrigger member.remove. 2. getMemberInfo du membre parti (cache). 3. sendMessage template rendu (sans ping, mention désactivée).',
  },
  {
    slug: 'onboarding-dm-guide',
    domain: 'onboarding',
    tags: ['DM', 'guide', 'parcours', 'découverte', 'étapes'],
    trigger: 'Guide du serveur envoyé en DM aux nouveaux membres avec étapes cliquables',
    params: {
      steps: str('Étapes au format titre:description séparées par point-virgule', 'Lis le règlement:obligatoire; Choisis tes rôles:panneau auto-rôles; Présente-toi:salon dédié'),
    },
    requiredTools: ['surface.create', 'sendDirectMessage', 'records.create'],
    workflow: '1. EventTrigger member.join (après acceptation du règlement si présent). 2. sendDirectMessage avec surface « Guide de démarrage » : une section par étape + boutons Étape suivante/Précédente. 3. Progression records par membre ; à 100 % : rôle Explorateur.',
  },
  {
    slug: 'returning-member-restore',
    domain: 'onboarding',
    tags: ['retour', 'rôles restaurés', 'rejoin', 'sticky roles', 'ancien membre'],
    trigger: 'Restaurer les rôles d\u0027un membre qui revient sur le serveur',
    params: {
      restoreDelayDays: num('Jours maximum d\u0027absence pour restaurer (0 = illimité)', 30),
    },
    requiredTools: ['records.search', 'addRoleToMember', 'sticky.role.add', 'sticky.role.remove', 'sendMessage'],
    workflow: '1. EventTrigger member.join. 2. records.search collection sticky_roles { userId }. 3. Si dernier départ < restoreDelayDays : ré-attribuer chaque rôle + sendMessage privé discret. 4. sticky.role.add maintient la sauvegarde à jour à chaque départ.',
  },
  {
    slug: 'gate-button-captcha',
    domain: 'onboarding',
    tags: ['vérification', 'bouton', 'captcha simple', 'gate', 'anti-bot'],
    trigger: 'Vérification par simple bouton avec kick automatique si ignoré',
    params: {
      verifiedRoleId: role('Rôle vérifié'),
      kickMinutes: num('Minutes avant kick', 30),
    },
    requiredTools: ['surface.create', 'addRoleToMember', 'kickMember', 'trigger.schedule'],
    workflow: '1. Salon #vérification : surface « Réagis pour prouver que tu es humain » avec bouton. 2. EventTrigger member.join : trigger.schedule kickMinutes (cancelKey = gate-{{userId}}). 3. Au clic : addRoleToMember + cancelByKey + suppression des messages du salon. 4. À l\u0027échéance sans clic : kickMember.',
  },
  {
    slug: 'roles-max-limit-per-category',
    domain: 'onboarding',
    tags: ['rôles', 'limite', 'maximum', 'catégorie', 'anti accumulation'],
    trigger: 'Limiter le nombre de rôles sélectionnables par catégorie d\u0027auto-rôles',
    params: {
      categories: str('Catégories au format titre:max séparées par point-virgule', 'Jeux:3, Intérêts:5'),
    },
    requiredTools: ['surface.create', 'addRoleToMember', 'removeRoleFromMember', 'getRoleMembers'],
    workflow: '1. Select par catégorie avec max affiché. 2. À la sélection : si le membre dépasse max dans la catégorie, replyEphemere « retire d\u0027abord un rôle ». 3. Sinon application normale.',
  },
  {
    slug: 'intro-thread-auto',
    domain: 'onboarding',
    tags: ['présentation', 'thread', 'auto', 'nouveau membre', 'se présente'],
    trigger: 'Créer automatiquement un fil de présentation pour chaque nouveau membre',
    params: {
      introChannelId: chan('Salon des présentations'),
      promptTemplate: str('Message initial du fil', 'Dis-nous tout {{user.mention}} : tes jeux, ta musique, ton café ou ton thé ?'),
    },
    requiredTools: ['thread.create', 'sendMessage', 'surface.create'],
    workflow: '1. EventTrigger member.join (après rôle vérifié). 2. thread.create dans le salon présentations nommé avec le pseudo. 3. sendMessage prompt. 4. Après 3 messages du membre dans SON fil : rôle Présenté + fermeture auto 7 jours.',
  },
  {
    slug: 'unverified-quarantine-view',
    domain: 'onboarding',
    tags: ['quarantaine', 'non vérifié', 'lecture seule', 'aperçu', 'salon unique'],
    trigger: 'Les non-vérifiés ne voient qu\u0027un salon de quarantaine avant validation',
    params: {
      quarantineChannelId: chan('Salon de quarantaine'),
      verifiedRoleId: role('Rôle vérifié'),
    },
    requiredTools: ['setChannelOverwrite', 'createCategory', 'addRoleToMember', 'surface.create'],
    workflow: '1. setChannelOverwrite : @everyone ne voit que le salon de quarantaine (et le rôle vérifié voit tout). 2. Surface dans le salon : règles + bouton de vérification. 3. Au clic valide : addRoleToMember (accès complet). 4. Kick auto après X heures sans vérification (trigger.schedule).',
  },
];
