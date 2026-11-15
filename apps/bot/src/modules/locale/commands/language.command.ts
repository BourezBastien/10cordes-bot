import { SlashCommand, SlashOption, SlashSubcommand } from '@spraxium/common';

// Handlers : LanguageSetHandler, LanguageViewHandler, LanguageResetHandler.
// La langue est propre à CHAQUE utilisateur — indépendante du serveur.
@SlashCommand({ name: 'language', description: 'Set your own bot language (per user, not per server).' })
export class LanguageCommand {
  @SlashOption.String('locale', {
    description: 'Preferred language',
    required: true,
    choices: [
      { name: 'Français', value: 'fr' },
      { name: 'English', value: 'en' },
    ],
  })
  @SlashSubcommand({ name: 'set', description: 'Set your preferred language.' })
  set() {}

  @SlashSubcommand({ name: 'view', description: 'Show your current language.' })
  view() {}

  @SlashSubcommand({ name: 'reset', description: 'Reset — auto-detect from your Discord client.' })
  reset() {}
}
