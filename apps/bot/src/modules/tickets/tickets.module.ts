import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import {
  TicketClaimHandler,
  TicketCloseHandler,
  TicketPanelOpenHandler,
  TicketHelpHandler,
  TicketUnclaimHandler,
  TicketRate1Handler,
  TicketRate2Handler,
  TicketRate3Handler,
  TicketRate4Handler,
  TicketRate5Handler,
} from './tickets.handlers';
import {
  TicketClaimButton,
  TicketCloseButton,
  TicketPanelButton,
  TicketHelpButton,
  TicketUnclaimButton,
  TicketRate1,
  TicketRate2,
  TicketRate3,
  TicketRate4,
  TicketRate5,
} from './components/ticket.components';
import { TicketsService } from './tickets.service';
import { TicketFirstResponseListener } from './listeners/ticket-first-response.listener';

@Module({
  imports: [GuildConfigModule, ToolRegistryModule],
  handlers: [
    TicketPanelOpenHandler,
    TicketClaimHandler,
    TicketUnclaimHandler,
    TicketCloseHandler,
    TicketHelpHandler,
    TicketRate1Handler,
    TicketRate2Handler,
    TicketRate3Handler,
    TicketRate4Handler,
    TicketRate5Handler,
  ],
  listeners: [TicketFirstResponseListener],
  providers: [TicketsService],
})
export class TicketsModule {}
