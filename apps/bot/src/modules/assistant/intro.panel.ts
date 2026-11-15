import { ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize } from 'discord.js';
import { text } from '../../shared/ui';

/** Panneau d'identité affiché quand on mentionne le bot sans demande précise. */
export function buildIntroPanel(locale: string): ContainerBuilder {
  const fr = locale === 'fr';
  const container = new ContainerBuilder().setAccentColor(0xd9_59_26);

  container.addTextDisplayComponents(
    text(
      fr
        ? '## 👋 Salut, je suis 10cordes !'
        : '## 👋 Hi, I am 10cordes!',
    ),
    text(
      fr
        ? [
            'Je suis ton **administrateur Discord délégué** : je gère ton serveur de A à Z.',
            'Parle-moi en langage naturel, je vérifie tes permissions, j\'agis avec mes tools, et je te demande confirmation avant tout acte destructeur.',
          ].join('\n')
        : [
            'I am your **delegated Discord administrator**: I run your server end to end.',
            'Talk to me in natural language, I check your permissions, act with my tools, and ask for confirmation before anything destructive.',
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
            '- **Réponds** à l\'une de mes réponses pour continuer la conversation',
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
      fr
        ? [
            '### 🛠️ Exemples',
            '`configure les logs dans #logs` · `crée un salon annonces`',
            '`montre-moi le top des membres` · `bannis ce trouble-maker` (confirmation)',
            '`retiens que le staff a le dernier mot` · `/setup` pour le panneau complet · `/help` pour tout',
          ].join('\n')
        : [
            '`route logs to #logs` · `create an announcements channel`',
            '`show me the member leaderboard` · `ban this trouble-maker` (confirmation)',
            '`remember staff has final say` · `/setup` for the full panel · `/help` for everything',
          ].join('\n'),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    text(fr ? '-# Mémoire persistante · permissions vérifiées · confirmation humaine sur le destructeur' : '-# Persistent memory · permission-checked · human-confirmed destructive actions'),
  );

  return container;
}
