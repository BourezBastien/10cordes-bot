import { Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { GiveawaysService } from './giveaways.service';

// Giveaways gérés par l'agent (lib discord-giveaways) : tools giveaway.*
// (start/drop/end/reroll/pause/unpause/list), annonces et tirages gérés par la lib.
@Module({
  imports: [ToolRegistryModule],
  providers: [GiveawaysService],
})
export class GiveawaysModule {}
