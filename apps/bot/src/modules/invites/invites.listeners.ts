import { Listener, On } from '@spraxium/common';
import { Events, type GuildMember } from 'discord.js';
import { InvitesService } from './invites.service';

/** Au memberAdd : diff du cache d'invites → crédit de l'inviteur réel. */
@Listener(Events.GuildMemberAdd)
export class InvitesMemberAddListener {
  constructor(private readonly invites: InvitesService) {}

  @On()
  async onMemberAdd(member: GuildMember): Promise<void> {
    await this.invites.creditJoin(member).catch(() => {});
  }
}
