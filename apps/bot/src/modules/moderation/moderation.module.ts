import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ModerationService } from './moderation.service';

// @Global : ModerationService est utilisé par l'agent admin et le tool-registry.
// Les sanctions passent par l'agent (discord.member.timeout/kick/ban + plans).
@Global()
@Module({
  imports: [AuditModule, GuildConfigModule],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
