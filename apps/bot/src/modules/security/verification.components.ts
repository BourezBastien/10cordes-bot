import { Button } from '@spraxium/components';

export const VERIFY_GATE_ID = 'verify:gate';
export const VERIFY_ANSWER_PREFIX = 'verify:ans';

@Button({ customId: VERIFY_GATE_ID, label: 'Je ne suis pas un robot', style: 'primary' })
export class VerifyGateButton {}

@Button({ customId: `${VERIFY_ANSWER_PREFIX}:0`, label: 'Réponse 1', style: 'secondary' })
export class VerifyAnswer0 {}
@Button({ customId: `${VERIFY_ANSWER_PREFIX}:1`, label: 'Réponse 2', style: 'secondary' })
export class VerifyAnswer1 {}
@Button({ customId: `${VERIFY_ANSWER_PREFIX}:2`, label: 'Réponse 3', style: 'secondary' })
export class VerifyAnswer2 {}
