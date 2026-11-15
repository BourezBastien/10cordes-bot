import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import {
  TicketCategoryHandler,
  TicketLogsHandler,
  TicketPanelChannelHandler,
  TicketSetupHandler,
  TicketStaffHandler,
  TicketPanelOpenHandler,
  TicketClaimHandler,
  TicketCloseHandler,
} from './tickets.handlers';
import { TicketClaimButton, TicketCloseButton, TicketPanelButton } from './components/ticket.components';
import { TicketsService } from './tickets.service';
import { SetupCommand } from '../setup/setup.schema';

@Module({
  imports: [GuildConfigModule],
  commands: [SetupCommand],
  handlers: [
    TicketCategoryHandler,
    TicketStaffHandler,
    TicketPanelChannelHandler,
    TicketLogsHandler,
    TicketSetupHandler,
    TicketPanelOpenHandler,
    TicketClaimHandler,
    TicketCloseHandler,
  ],
  providers: [TicketsService],
})
export class TicketsModule {}
