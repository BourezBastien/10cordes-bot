import type { IntroData } from '../v2.containers';

/** Données brutes du panneau d'identité. */
export interface IntroView {
  botName: string;
  displayName: string;
  /** Le demandeur gère le serveur (ManageGuild, Administrator ou owner) ? */
  staff: boolean;
  avatarUrl: string;
}

/**
 * Panneau d'identité (mention nue ou salutation, sans appel LLM) : construit
 * les données du composant V2 IntroContainer. Pur : ni appel API ni effet
 * de bord, le service se charge du rendu.
 */
export class IntroPresenter {
  private static readonly ROLE_LINE_STAFF = 'Ton **administrateur Discord délégué** : je pilote ton serveur de A à Z, sous tes ordres, ';
  private static readonly ROLE_LINE_MEMBER = 'L\u0027**assistant IA du serveur** : pose tes questions, demande ton rang, navigue dans les tags, ';
  private static readonly PERMS_LINE = "Je vérifie toujours tes permissions avant d'agir, et je demande confirmation avant tout acte destructeur.";
  private static readonly TALK_LINES = [
    '- **Mentionne-moi** avec ta demande : `@10cordes active les logs`',
    '- **Écris simplement ici** : le salon dédié IA me relie directement',
    '- **Réponds** à l\u0027une de mes réponses pour continuer',
  ].join('\n');
  private static readonly STAFF_EXAMPLES = [
    '- `configure les logs dans #logs` · `crée un salon annonces`',
    '- `bannis ce trouble-maker` (je demande confirmation) · `présente le serveur`',
    '- Le bouton **Panneau de configuration** ci-dessous · ',
  ].join('\n');
  private static readonly MEMBER_EXAMPLES = [
    '- `mon rang` · `le classement` · `montre-moi le tag règles`',
    '- Partage tes préférences : ma mémoire les retient',
    '- ',
  ].join('\n');
  private static readonly MEMORY_LINE = 'Mémoire persistante · permissions vérifiées · confirmation humaine sur le destructeur';

  introData(view: IntroView): IntroData {
    const { botName, displayName, staff, avatarUrl } = view;
    return {
      botName,
      displayName,
      staff,
      avatarUrl,
      roleLine:
        (staff ? IntroPresenter.ROLE_LINE_STAFF : IntroPresenter.ROLE_LINE_MEMBER) + `${displayName}.`,
      permsLine: IntroPresenter.PERMS_LINE,
      talkLines: IntroPresenter.TALK_LINES,
      exampleLines: staff ? IntroPresenter.STAFF_EXAMPLES : IntroPresenter.MEMBER_EXAMPLES,
      memoryLine: IntroPresenter.MEMORY_LINE,
    };
  }
}
