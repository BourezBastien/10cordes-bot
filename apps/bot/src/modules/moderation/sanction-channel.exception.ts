import { SpraxiumException } from '@spraxium/core';

/** Levée quand la commande est utilisée hors des salons whitelistés du module. */
export class SanctionChannelException extends SpraxiumException {
  constructor(channelId: string) {
    super({
      code: 'SANCTION_CHANNEL',
      message: 'Les sanctions sont réservées au salon <#{{channelId}}>.',
      props: { channelId },
    });
  }
}
