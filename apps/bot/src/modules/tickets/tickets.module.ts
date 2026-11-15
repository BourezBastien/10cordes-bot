import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { TicketClaimHandler, TicketCloseHandler, TicketPanelOpenHandler } from './tickets.handlers';
import { TicketClaimButton, TicketCloseButton, TicketPanelButton } from './components/ticket.components';
import { TicketsService } from './tickets.service';

@Module({
  imports: [GuildConfigModule, ToolRegistryModule],
  handlers: [TicketPanelOpenHandler, TicketClaimHandler, TicketCloseHandler],
  providers: [TicketsService],
})
export class TicketsModule {}
