import { Listener, On } from '@spraxium/common';
import { Events, type Message } from 'discord.js';
import { LevelsService } from './levels.service';

/** XP passif : un message humain = XP (cooldown géré dans le service). */
@Listener(Events.MessageCreate)
export class LevelsMessageListener {
  constructor(private readonly levels: LevelsService) {}

  @On()
  async onMessageCreate(message: Message): Promise<void> {
    await this.levels.grantForMessage(message).catch(() => {});
  }
}
