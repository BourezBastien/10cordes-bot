import type { BotTool } from '@10cordes/shared';
import { activitySummaryTool, memberRankTool, serverTopTool } from './serverlife-activity.tools';
import { pickRandomTool, voiceActivityTool } from './serverlife-animation.tools';
import { dehoistTool, lockdownTool, memberTrustTool, snipeTool, tempSanctionTool } from './serverlife-moderation.tools';
import { afkClearTool, afkSetTool, birthdayListTool, birthdaySetTool, stickyRoleAddTool, stickyRoleRemoveTool } from './serverlife-social.tools';
import type { ServerlifeToolsDeps } from './serverlife.tool-deps';

/**
 * Tools vie de serveur exposés à l'agent (ordre d'enregistrement au boot, à
 * conserver tel quel : le registry liste les tools par ordre d'arrivée).
 */
export function buildServerlifeTools(deps: ServerlifeToolsDeps): BotTool[] {
  return [
    snipeTool(deps),
    pickRandomTool(deps),
    afkSetTool(deps),
    afkClearTool(deps),
    birthdaySetTool(deps),
    birthdayListTool(deps),
    stickyRoleAddTool(deps),
    stickyRoleRemoveTool(deps),
    voiceActivityTool(deps),
    lockdownTool(deps),
    dehoistTool(deps),
    memberTrustTool(deps),
    tempSanctionTool(deps),
    memberRankTool(deps),
    serverTopTool(deps),
    activitySummaryTool(deps),
  ];
}
