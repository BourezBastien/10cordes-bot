/**
 * Lexique de l'intention d'action : le signal `verb` de detectRequestIntent
 * (request-intent.ts).
 *
 * Une demande est orientée ACTION quand elle dit de muter, de créer ou de
 * configurer le serveur, ou d'y planifier quelque chose. Les verbes nus trop
 * généraux n'y figurent pas : « ça va mettre combien de temps ? » est une
 * question, pas un ordre. Seules les locutions « mettre à jour » et
 * « mettre en place » comptent.
 *
 * MOT ENTIER : chaque entrée est encadrée par des frontières Unicode (ni
 * lettre ni chiffre de part et d'autre). La frontière de mot native de
 * JavaScript est ASCII : devant un accent (« éditer », « épingler ») elle ne
 * matche jamais. Et « banane » ne doit pas matcher « ban ».
 */

/** Ni lettre ni chiffre avant. */
const START = String.raw`(?<![\p{L}\p{N}])`;
/** Ni lettre ni chiffre après. */
const END = String.raw`(?![\p{L}\p{N}])`;

/** Terminaisons des verbes du premier groupe. Pas de participe passé : « créé », « supprimé » racontent un état, pas un ordre. */
const ER = '(?:er|e|es|ons|ez|ent|ant)';

/** Déterminants : la cible d'un ordre est introduite par l'un d'eux. */
const DETERMINER = String.raw`(?:l'|le|la|les|un|une|des|du|d'|ce|cette|ces|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|votre|leur|leurs|tout|toute|tous|toutes|chaque)`;

/** Verbes du premier groupe sans homonyme courant : toute position. */
const FREE_ER_STEMS = [
  'cré',
  'supprim',
  'effac',
  'renomm',
  'remplac',
  'dépla[cç]',
  'expuls',
  'ajout',
  'retir',
  'enl[èe]v',
  'désactiv',
  'réactiv',
  'configur',
  'modifi',
  'édit',
  'chang',
  'ajust',
  'appliqu',
  'planifi',
  'annul',
  'épingl',
  'désépingl',
  'génér',
  'duplic',
  'fusionn',
  'purg',
  'export',
  'sauvegard',
  'ouvr',
  'publi',
  'install',
  'connect',
  'd[ée]marr',
  'ex[ée]cut',
  'autoris',
  'assign',
  'nettoy',
  'verrouill',
  'd[ée]verrouill',
  'rappell?',
  'lan[cç]',
  'réorganis',
].map((stem) => `${stem}${ER}`);

/**
 * Verbes du premier groupe homonymes d'un nom ou d'un adjectif (« la règle
 * active », « l'archive du salon », « à son poste », « un clone », « le
 * programme », « la limite », « la ferme », « une invite », « le mute »).
 * Ils ne comptent qu'en tête de la demande (« active la règle », « invite
 * Paul ») ou après un sujet, suivis d'un déterminant (« tu actives la règle »).
 */
// « règle » (accent grave), « réglons » (aigu), « regle » (saisie sans accent).
const NOUN_LIKE_ER_STEMS = ['r[èeé]gl', 'activ', 'archiv', 'post', 'programm', 'limit', 'clon', 'invit', 'mut', 'ferm'];
const SUBJECT = String.raw`je|tu|il|elle|on|nous|vous|ils|elles|que|qui|faut|et|puis|ou|pour|sans|va`;
const nounLike = (stem: string): string =>
  `(?:^${stem}(?:er|e|es|ons|ez|ent)(?=\\s|$|,|:)|(?<=\\b(?:${SUBJECT})\\s)${stem}(?:er|e|es|ons|ez|ent)\\s+${DETERMINER}(?![\\p{L}\\p{N}]))`;

/** Verbes irréguliers et locutions. */
const IRREGULAR = [
  'bann(?:ir|is|it|issons|issez|issent|issant)',
  'exclu(?:re|s|ons|ez|ent|ant)',
  'interdi(?:re|s|sons|sez|sent|sant)',
  'averti(?:r|s|ssons|ssez|ssent)',
  'd[ée]fin(?:ir|is|issons|issez|issent|issant)',
  // « n'importe quoi », « peu importe » : l'infinitif en -er et l'impératif restent seuls.
  'import(?:er|ons|ez|ent|ant)',
  'envoi(?:e|es|ent)',
  'envoy(?:er|ons|ez|ant)',
  String.raw`met(?:re|s|tons|tez)\s+à\s+jour`,
  String.raw`met(?:re|s|tons|tez)\s+en\s+place`,
  // « fait que Paul ait accès à », « veulent qu'ils aient accès à » : au subjonctif, c'est un ordre.
  String.raw`(?:ait|aient)\s+accès`,
  // Donner et accorder, seulement avec un rôle, une permission ou un accès pour objet.
  String.raw`(?:donn(?:er|e|es|ons|ez|ent)|accord(?:er|e|es|ons|ez|ent))(?:-\p{L}+)?\s+(?:[\p{L}\p{N}_-]+\s+){0,4}?(?:r[ôo]les?|permissions?|acc[èe]s|admin|mod[ée]rateurs?)`,
];

/** Anglais courant, formes simples (le serveur peut être anglophone). */
const ENGLISH = [
  'create',
  'delete',
  'remove',
  'add',
  'rename',
  'kick',
  'ban',
  'unban',
  'set',
  'edit',
  'change',
  'schedule',
  'pin',
  'unpin',
  'generate',
  'configure',
  'enable',
  'disable',
  'purge',
  'assign',
  'reset',
];

const ALTERNATION = [
  ...FREE_ER_STEMS,
  ...NOUN_LIKE_ER_STEMS.map(nounLike),
  ...IRREGULAR,
  `(?:${ENGLISH.join('|')})(?:s|ed)?`,
].join('|');

/** Premier verbe d'action de la demande (texte en minuscules). */
export const ACTION_VERB_RE = new RegExp(`${START}(?:${ALTERNATION})${END}`, 'u');

/**
 * Mot interrogatif : la demande porte alors sur le savoir-faire ou sur un
 * fait, pas sur l'action (« comment supprimer un salon ? »).
 */
export const QUESTION_MARKER_RE = new RegExp(
  `${START}(?:comment|combien|pourquoi|quand|où|qui|quels?|quelles?|qu['’]est-ce\\s+que?|c['’]est\\s+quoi|est-ce\\s+qu(?:e|['’])|sais-tu|sait-on|tu\\s+sais|vous\\s+savez|y\\s+a-t-il)`,
  'u',
);

/**
 * Préface de capacité polie, en tête de la demande : « est-ce que tu peux »,
 * « pourrais-tu », « peux-tu », « on peut ». L'action qui la suit n'est pas
 * une question (« est-ce que tu peux créer un système de tickets ? »).
 */
export const POLITE_PREFACE_RE = new RegExp(
  String.raw`^(?:(?:hey|salut|bonjour|bonsoir|coucou|hello|slt|yo|10cordes)[\s,!:.-]*)*(?:est-ce\s+qu(?:e|')\s+)?(?:(?:tu|on|vous)\s+)?(?:peux-tu|pourrais-tu|saurais-tu|peut-on|pourrait-on|pouvez-vous|pourriez-vous|pourriez|pourrais|pouvez|peux|peut|saurais)(?![\p{L}\p{N}])`,
  'u',
);
