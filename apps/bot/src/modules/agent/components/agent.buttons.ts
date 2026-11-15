import { Button } from '@spraxium/components';

export const AGENT_APPROVE_ID = 'agent:approve';
export const AGENT_CANCEL_ID = 'agent:cancel';

@Button({ customId: AGENT_APPROVE_ID, label: '✅ Approuver', style: 'success' })
export class AgentApproveButton {}

@Button({ customId: AGENT_CANCEL_ID, label: '✖ Annuler', style: 'secondary' })
export class AgentCancelButton {}
