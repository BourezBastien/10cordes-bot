import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { ServerlifeService } from './serverlife.service';
import {
  SnipeDeleteListener,
  SnipeEditListener,
  ServerlifeMessageListener,
  StickyRolesListener,
  VoiceMinutesListener,
} from './serverlife.listeners';

// Vie de serveur : snipe, AFK, anniversaires, sticky roles, lockdown/dehoist,
// activités vocales, sanctions temporaires auto-révoquées, trust score,
// comptage d'activité (rank/top).
@Module({
  imports: [GuildConfigModule, ToolRegistryModule],
  providers: [ServerlifeService],
  listeners: [SnipeDeleteListener, SnipeEditListener, ServerlifeMessageListener, StickyRolesListener, VoiceMinutesListener],
})
export class ServerlifeModule {}
