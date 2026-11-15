import { Global, Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { LocaleDetectListener } from './listeners/locale-detect.listener';
import { LocaleToolsService } from './locale.tools';
import { LocaleService } from './locale.service';

// @Global : LocaleService est consommé par tous les modules (langue par utilisateur).
// Plus de commande /lang : la langue se change en langage naturel (setMyLanguage).
@Global()
@Module({
  imports: [ToolRegistryModule],
  listeners: [LocaleDetectListener],
  providers: [LocaleService, LocaleToolsService],
  exports: [LocaleService],
})
export class LocaleModule {}
