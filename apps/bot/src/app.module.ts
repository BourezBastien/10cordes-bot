import { Module } from '@spraxium/common';
import { DatabaseModule } from './modules/database/database.module';
import { GuildConfigModule } from './modules/guild-config/guild-config.module';
import { LocaleModule } from './modules/locale/locale.module';
import { ModuleManagerModule } from './modules/module-manager/module-manager.module';
import { PingModule } from './modules/ping/ping.module';

@Module({
  imports: [DatabaseModule, GuildConfigModule, LocaleModule, ModuleManagerModule, PingModule],
})
export class AppModule {}
