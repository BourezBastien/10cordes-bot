import { Module } from '@spraxium/common';
import { InfoCommand, InfoHandler } from './info';

@Module({
  commands: [InfoCommand],
  handlers: [InfoHandler],
})
export class InfoModule {}
