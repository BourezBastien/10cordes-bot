import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { BanAddListener } from './listeners/ban.listener';
import { MemberUpdateListener } from './listeners/member-update.listener';
import { MessageDeleteListener, MessageUpdateListener } from './listeners/message.listeners';
import { VoiceStateListener } from './listeners/voice.listener';
import { LoggingService } from './logging.service';

@Module({
  imports: [GuildConfigModule, ToolRegistryModule],
  listeners: [MessageDeleteListener, MessageUpdateListener, MemberUpdateListener, VoiceStateListener, BanAddListener],
  providers: [LoggingService],
  exports: [LoggingService],
})
export class LoggingModule {}
