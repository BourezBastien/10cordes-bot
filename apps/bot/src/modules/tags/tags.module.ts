import { Module } from '@spraxium/common';
import { TagAddHandler, TagCommand, TagDeleteHandler, TagEditHandler, TagListHandler, TagShowHandler } from './tag.command';
import { TagsService } from './tags.service';

@Module({
  commands: [TagCommand],
  handlers: [TagAddHandler, TagEditHandler, TagDeleteHandler, TagShowHandler, TagListHandler],
  providers: [TagsService],
})
export class TagsModule {}
