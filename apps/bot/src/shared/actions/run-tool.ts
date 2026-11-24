import type { ToolRunContext } from '@10cordes/shared';
import { getToolRegistry } from '../../modules/tool-registry/tool-registry.service';

/**
 * Exécutions de tools déclenchées hors conversation (bouton, job planifié).
 * centralisées ici : UNE seule porte d'élévation, auditable, au lieu de
 * duplicats `permissions: ['Administrator']` dispersés.
 */

export interface ToolActor {
  guildId: string | null;
  channelId: string | null;
  userId: string;
  /** Permissions Discord RÉELLES de l'acteur (membre qui clique). */
  permissions: string[];
  /** Rôles réels de l'acteur : les permission nodes deny s'appliquent. */
  roleIds: string[];
}

/**
 * Exécute un tool au nom du membre qui a cliqué : permissions et rôles
 * réels transmis au registry : un node deny ou un manque de permission
 * Discord refuse donc le clic comme il refuserait une demande directe.
 * Le clic est l'autorisation de l'action : la règle de confirmation des
 * actions (qui vise ce que le modèle propose en conversation) ne s'y applique pas.
 */
export async function runToolAsActor(
  name: string,
  input: unknown,
  actor: ToolActor,
): Promise<{ ok: boolean; summary: string }> {
  const ctx: ToolRunContext = {
    guildId: actor.guildId,
    channelId: actor.channelId,
    userId: actor.userId,
    locale: 'fr',
    permissions: actor.permissions,
    roleIds: actor.roleIds,
    approvedBy: 'surface',
    reply: async () => {},
  };
  return getToolRegistry().run(name, input, ctx);
}

/**
 * Exécute un tool en tant que système (job planifié, tâche de fond) : le
 * bot agit de sa propre autorité. Le job a lui-même été créé via un tool
 * gated (jobs.schedule = ManageGuild), la traçabilité passe par l'audit
 * du registry (userId = bot). Autorisé depuis sa création : la règle de
 * confirmation ne s'y applique pas.
 */
export async function runToolAsSystem(
  name: string,
  input: unknown,
  scope: { guildId: string | null; channelId?: string | null; botUserId: string },
): Promise<{ ok: boolean; summary: string }> {
  const ctx: ToolRunContext = {
    guildId: scope.guildId,
    channelId: scope.channelId ?? null,
    userId: scope.botUserId,
    locale: 'fr',
    permissions: ['Administrator'],
    roleIds: [],
    approvedBy: 'system',
    reply: async () => {},
  };
  return getToolRegistry().run(name, input, ctx);
}
