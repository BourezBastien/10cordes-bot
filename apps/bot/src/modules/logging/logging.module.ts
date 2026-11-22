import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import {
  AuditBanAddListener,
  AuditBanRemoveListener,
  AuditChannelCreatedListener,
  AuditChannelDeletedListener,
  AuditEmojiUpdatedListener,
  AuditInviteCreatedListener,
  AuditInviteDeletedListener,
  AuditMemberJoinedListener,
  AuditMemberLeftListener,
  AuditMessageCreatedListener,
  AuditRoleCreatedListener,
  AuditRoleDeletedListener,
} from './listeners/audit.listeners';
import { BanAddListener } from './listeners/ban.listener';
import { MemberUpdateListener } from './listeners/member-update.listener';
import { MessageDeleteListener, MessageUpdateListener } from './listeners/message.listeners';
import { VoiceStateListener } from './listeners/voice.listener';
import { LoggingService } from './logging.service';
import { FileLogService } from './file-log.service';

// AUDIT COMPLET (décision 18/11) : tous les events audibles sont journalisés
// par défaut sur tous les serveurs (audit + salons de logs configurés).
// R3 : FileLogService (JSONL + rotation + miroir console) démarre ICI, avant
// tous les modules qui instrumentent via fileLog().
@Module({
  imports: [GuildConfigModule, ToolRegistryModule],
  listeners: [
    MessageDeleteListener,
    MessageUpdateListener,
    AuditMessageCreatedListener,
    MemberUpdateListener,
    AuditMemberJoinedListener,
    AuditMemberLeftListener,
    VoiceStateListener,
    BanAddListener,
    AuditBanAddListener,
    AuditBanRemoveListener,
    AuditChannelCreatedListener,
    AuditChannelDeletedListener,
    AuditRoleCreatedListener,
    AuditRoleDeletedListener,
    AuditEmojiUpdatedListener,
    AuditInviteCreatedListener,
    AuditInviteDeletedListener,
  ],
  providers: [
    LoggingService,
    FileLogService,
  ],
  exports: [LoggingService, FileLogService],
})
export class LoggingModule {}
