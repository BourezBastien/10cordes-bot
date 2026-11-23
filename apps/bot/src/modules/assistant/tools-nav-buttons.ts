import { Button } from '@spraxium/components';

/** Navigation du panneau tools paginé — ids câblés aux handlers tools-page. */
export const TOOLS_NAV_PREV_ID = 'tools:nav-prev';
export const TOOLS_NAV_NEXT_ID = 'tools:nav-next';

@Button({ customId: TOOLS_NAV_PREV_ID, label: '<', style: 'secondary' })
export class ToolsPrevButton {}

@Button({ customId: TOOLS_NAV_NEXT_ID, label: '>', style: 'secondary' })
export class ToolsNextButton {}
