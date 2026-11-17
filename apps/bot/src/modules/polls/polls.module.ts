import { Module } from '@spraxium/common';
import { ComponentsModule } from '@spraxium/components';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { PollsService } from './polls.service';

// Sondages à durée : tools createPoll/poll.close, boutons de vote
// (polls.handlers), clôture automatique avec résultats (timer + sweep boot).
@Module({
  imports: [ToolRegistryModule, ComponentsModule],
  providers: [PollsService],
})
export class PollsModule {}
