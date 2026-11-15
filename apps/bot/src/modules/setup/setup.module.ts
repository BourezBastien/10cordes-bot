import { Module } from '@spraxium/common';
import { SetupCommand, SetupHandler } from './setup.command';
import { SetupLanguageSelectHandler, SetupWelcomeChannelSelectHandler, SetupWelcomeToggleHandler } from './setup.handlers';

@Module({
  commands: [SetupCommand],
  handlers: [SetupHandler, SetupLanguageSelectHandler, SetupWelcomeChannelSelectHandler, SetupWelcomeToggleHandler],
})
export class SetupModule {}
