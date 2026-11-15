import { Module } from '@spraxium/common';
import { TagsService } from './tags.service';

@Module({
  providers: [TagsService],
})
export class TagsModule {}
