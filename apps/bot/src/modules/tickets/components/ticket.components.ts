import { Button } from '@spraxium/components';

export const TICKET_PANEL_OPEN_ID = 'ticket:open';
export const TICKET_CLAIM_ID = 'ticket:claim';
export const TICKET_CLOSE_ID = 'ticket:close';
export const TICKET_HELP_ID = 'ticket:help';

@Button({ customId: TICKET_PANEL_OPEN_ID, label: '📬 Ouvrir un ticket', style: 'primary' })
export class TicketPanelButton {}

@Button({ customId: TICKET_CLAIM_ID, label: '🙋 Claim', style: 'secondary' })
export class TicketClaimButton {}

@Button({ customId: TICKET_CLOSE_ID, label: '🔒 Fermer', style: 'danger' })
export class TicketCloseButton {}

@Button({ customId: TICKET_HELP_ID, label: '🆘 Demander de l\u0027aide', style: 'primary' })
export class TicketHelpButton {}
