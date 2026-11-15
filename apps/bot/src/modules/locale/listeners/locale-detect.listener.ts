import { Listener, On } from '@spraxium/common';
import { Events, type Interaction } from 'discord.js';
import { LocaleService } from '../locale.service';

/** Capture la langue du client Discord de chaque utilisateur à sa première interaction. */
@Listener(Events.InteractionCreate)
export class LocaleDetectListener {
  constructor(private readonly locales: LocaleService) {}

  @On()
  onInteractionCreate(interaction: Interaction): void {
    void this.locales.detect(interaction.user.id, interaction.locale).catch(() => {});
  }
}
