import { Button } from '@spraxium/components';

export const TICKET_PANEL_OPEN_ID = 'ticket:open';
export const TICKET_CLAIM_ID = 'ticket:claim';
export const TICKET_CLOSE_ID = 'ticket:close';
export const TICKET_HELP_ID = 'ticket:help';
export const TICKET_UNCLAIM_ID = 'ticket:unclaim';
export const TICKET_RATE_PREFIX = 'ticket:rate';

@Button({ customId: TICKET_PANEL_OPEN_ID, label: '📬 Ouvrir un ticket', style: 'primary' })
export class TicketPanelButton {}

@Button({ customId: TICKET_CLAIM_ID, label: '🙋 Claim', style: 'secondary' })
export class TicketClaimButton {}

@Button({ customId: TICKET_UNCLAIM_ID, label: '↩️ Unclaim', style: 'secondary' })
export class TicketUnclaimButton {}

@Button({ customId: TICKET_CLOSE_ID, label: '🔒 Fermer', style: 'danger' })
export class TicketCloseButton {}

@Button({ customId: TICKET_HELP_ID, label: '🆘 Demander de l\u0027aide', style: 'primary' })
export class TicketHelpButton {}

@Button({ customId: `${TICKET_RATE_PREFIX}:1`, label: '1★', style: 'secondary' })
export class TicketRate1 {}
@Button({ customId: `${TICKET_RATE_PREFIX}:2`, label: '2★', style: 'secondary' })
export class TicketRate2 {}
@Button({ customId: `${TICKET_RATE_PREFIX}:3`, label: '3★', style: 'secondary' })
export class TicketRate3 {}
@Button({ customId: `${TICKET_RATE_PREFIX}:4`, label: '4★', style: 'secondary' })
export class TicketRate4 {}
@Button({ customId: `${TICKET_RATE_PREFIX}:5`, label: '5★', style: 'secondary' })
export class TicketRate5 {}
