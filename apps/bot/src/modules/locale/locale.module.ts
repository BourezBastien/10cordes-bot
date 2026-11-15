import { Module } from '@spraxium/common';
import { LanguageCommand } from './commands/language.command';
import { LanguageResetHandler, LanguageSetHandler, LanguageViewHandler } from './handlers/language.handlers';
import { LocaleDetectListener } from './listeners/locale-detect.listener';
import { LocaleService } from './locale.service';

@Module({
  commands: [LanguageCommand],
  handlers: [LanguageSetHandler, LanguageViewHandler, LanguageResetHandler],
  listeners: [LocaleDetectListener],
  providers: [LocaleService],
  exports: [LocaleService],
})
export class LocaleModule {}
