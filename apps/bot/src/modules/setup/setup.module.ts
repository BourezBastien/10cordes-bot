import { Module } from '@spraxium/common';
import { SetupHandler } from './setup.command';
import { SetupCommand } from './setup.schema';
import {
  SetupAssistantChannelSelectHandler,
  SetupAssistantClearHandler,
  SetupLanguageSelectHandler,
  SetupWelcomeChannelSelectHandler,
  SetupWelcomeToggleHandler,
} from './setup.handlers';

@Module({
  commands: [SetupCommand],
  handlers: [
    SetupHandler,
    SetupLanguageSelectHandler,
    SetupWelcomeChannelSelectHandler,
    SetupWelcomeToggleHandler,
    SetupAssistantChannelSelectHandler,
    SetupAssistantClearHandler,
  ],
})
export class SetupModule {}
