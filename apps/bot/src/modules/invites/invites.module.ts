import { Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { InvitesService } from './invites.service';
import { InvitesMemberAddListener } from './invites.listeners';

// Tracking des invitations : diff de cache au memberAdd, compteur par inviteur,
// leaderboard et corrections staff.
@Module({
  imports: [ToolRegistryModule],
  providers: [InvitesService],
  listeners: [InvitesMemberAddListener],
})
export class InvitesModule {}
