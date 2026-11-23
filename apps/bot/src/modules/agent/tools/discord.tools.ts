import type { BotTool } from '@10cordes/shared';
import type { Client } from 'discord.js';
import type { AgentService } from '../agent.service';
import { categoryTools } from './category.tools';
import { channelTools } from './channel.tools';
import { destructiveTools } from './destructive.tools';
import { memberTools } from './member.tools';
import { messageTools } from './message.tools';
import { roleTools } from './role.tools';
import { serverActivityTools } from './server-activity.tools';
import { serverReadTools } from './server-read.tools';
import { createDiscordToolContext } from './tool-context';

/**
 * Tools Discord de l'Agent Admin : agrégation des tools par responsabilité
 * (lecture du serveur, salons, rôles et sanctions, membres, messages,
 * activité, opérations destructives). Chaque tool embarque son propre
 * systemPrompt (préconditions, effets, refus) et exécute DIRECTEMENT (plus de
 * plans depuis le 17/11) : gates de permissions en code pour le demandeur ET
 * le bot, archive-first pour les suppressions, tout audité.
 */
export function agentTools(agent: AgentService, client: Client): BotTool[] {
  const toolCtx = createDiscordToolContext(agent, client);
  return [
    ...serverReadTools(toolCtx),
    ...channelTools(toolCtx),
    ...categoryTools(toolCtx),
    ...roleTools(toolCtx),
    ...memberTools(toolCtx),
    ...messageTools(toolCtx),
    ...serverActivityTools(toolCtx),
    ...destructiveTools(toolCtx),
  ];
}
