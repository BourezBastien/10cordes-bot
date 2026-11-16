import { ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize } from 'discord.js';
import { text } from '../../shared/ui';

/**
 * Panneau d'identité affiché quand on mentionne le bot sans demande précise.
 * Le contenu s'adapte : staff (pilotage complet) vs membre (usages utiles),
 * avec le pseudo de la personne qui mentionne.
 */
export function buildIntroPanel(locale: string, displayName: string, isStaff: boolean): ContainerBuilder {
  const fr = locale === 'fr';
  const container = new ContainerBuilder().setAccentColor(0xd9_59_26);

  container.addTextDisplayComponents(
    text(fr ? `## 👋 Salut ${displayName}, je suis 10cordes !` : `## 👋 Hi ${displayName}, I am 10cordes!`),
    text(
      fr
        ? [
            isStaff
              ? 'Ton **administrateur Discord délégué** : je pilote ton serveur de A à Z, sous tes ordres.'
              : "L'**assistant IA du serveur** : pose-moi des questions, demande ton rang, regarde les tags, et je note ce que tu aimes pour mieux te répondre.",
            "Je vérifie toujours tes permissions avant d'agir, et je demande confirmation avant tout acte destructeur.",
          ].join('\n')
        : [
            isStaff
              ? 'Your **delegated Discord administrator**: I run your server end to end, under your direction.'
              : 'The server\u2019s **AI assistant**: ask questions, get your rank, browse tags \u2014 and I remember what you like.',
            'I always check your permissions before acting, and confirm before anything destructive.',
          ].join('\n'),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  container.addTextDisplayComponents(
    text(
      fr
        ? [
            '### 💬 Comment me parler',
            '- **Mentionne-moi** avec ta demande : `@10cordes active les logs`',
            "- **Réponds** à l'une de mes réponses pour continuer la conversation",
            '- **Salon dédié IA** : configure-le dans `/setup` → Agent IA',
          ].join('\n')
        : [
            '### 💬 How to talk to me',
            '- **Mention me** with your request: `@10cordes enable logs`',
            '- **Reply** to one of my answers to keep the conversation going',
            '- **Dedicated AI channel**: set it in `/setup` → Agent IA',
          ].join('\n'),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  container.addTextDisplayComponents(
    text(
      isStaff
        ? [
            '### 🛠️ Exemples',
            '`configure les logs dans #logs` · `crée un salon annonces`',
            '`montre-moi le top des membres` · `bannis ce trouble-maker` (confirmation)',
            '`retiens que le staff a le dernier mot` · `/setup` pour le panneau complet · `/help` pour tout',
          ].join('\n')
        : [
            '### 🛠️ Exemples',
            '`mon rang` · `le classement` · `montre-moi le tag règles`',
            'Pose tes questions sur le serveur, et partage tes préférences : je m\u2019en souviens.',
            '`/setup` reste réservé au staff · `/help` pour tout',
          ].join('\n'),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    text(
      fr
        ? '-# Mémoire persistante · permissions vérifiées · confirmation humaine sur le destructeur'
        : '-# Persistent memory · permission-checked · human-confirmed destructive actions',
    ),
  );

  return container;
}
