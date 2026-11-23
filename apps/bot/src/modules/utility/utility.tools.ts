import type { BotTool } from '@10cordes/shared';
import type { UtilityToolsDeps } from './utility-resolver';
import { channelHistorySearchTool, membersExportTool, messagesExportTool } from './utility-history.tools';
import { eventScheduleTool } from './utility-event.tools';
import { forumPostTool, threadAddMemberTool, threadCreateTool } from './utility-thread.tools';
import { messageCrosspostTool, messagePinTool, messageUnpinTool, reactionAddTool, webhookPostTool } from './utility-message.tools';

export type { UtilityToolsDeps } from './utility-resolver';

/**
 * Tools du module utility, dans leur ordre d'enregistrement au boot.
 * Répartition : utility-history.tools.ts (lecture et exports),
 * utility-event.tools.ts (événement natif), utility-thread.tools.ts (forum et
 * fils), utility-message.tools.ts (messages et annonces).
 */
export function buildUtilityTools(deps: UtilityToolsDeps): BotTool[] {
  return [
    channelHistorySearchTool(deps),
    messagesExportTool(deps),
    membersExportTool(deps),
    eventScheduleTool(deps),
    forumPostTool(deps),
    threadCreateTool(deps),
    messagePinTool(deps),
    messageUnpinTool(deps),
    webhookPostTool(deps),
    threadAddMemberTool(deps),
    messageCrosspostTool(deps),
    reactionAddTool(deps),
  ];
}
