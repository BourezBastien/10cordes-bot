import { SurfaceDefinitionSchema, type ToolResult, type ToolRunContext } from '@10cordes/shared';
import type { AuditService } from '../audit/audit.service';
import type { RegistryRuntimeDeps } from './tool-registry.runtime';

/** Hash stable d'un input (clé de confirmation indépendante de l'ordre des clés). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
}

/** Clé d'accord d'une action destructive : posée par le clic ✅, vérifiée au re-run. */
export function confirmKeyFor(guildId: string, toolName: string, input: unknown): string {
  return `confirm:${guildId}:${toolName}:${stableStringify(input)}`;
}

/**
 * Surface de confirmation ✅/❌ (R0.4c) : boutons réservés à l'auteur
 * (AccessPolicy userIds). Le clic ✅ pose la clé ICacheStore (géré par
 * SurfaceService quand kind=confirm), la ré-exécution du tool passe ensuite.
 * Rend false quand la surface n'a pas pu être affichée.
 */
async function postConfirmSurface(toolName: string, input: unknown, ctx: ToolRunContext, deps: RegistryRuntimeDeps): Promise<boolean> {
  if (!ctx.guildId || !deps.cache || !ctx.channelId || !deps.prisma || !deps.renderSurface) return false;
  try {
    const confirmKey = confirmKeyFor(ctx.guildId, toolName, input);
    const definition = SurfaceDefinitionSchema.parse({
      title: `Confirmer : ${toolName}`,
      description: `Action destructive demandée par <@${ctx.userId}>. Confirmer exécutera le tool « ${toolName} » ; Annuler ne fera rien. Boutons réservés au demandeur, valides 5 minutes.`,
      rows: [
        {
          kind: 'buttons',
          buttons: [
            {
              key: 'confirmer',
              label: '✅ Confirmer',
              style: 'success',
              access: { userIds: [ctx.userId] },
              pipeline: [{ type: 'replyEphemeral', content: 'Confirmé : le bot va relancer l\u0027action, elle passera cette fois.' }],
            },
            {
              key: 'annuler',
              label: '❌ Annuler',
              style: 'danger',
              access: { userIds: [ctx.userId] },
              pipeline: [{ type: 'replyEphemeral', content: 'Annulé : rien ne sera exécuté.' }],
            },
          ],
        },
      ],
      initialState: { confirmKey, tool: toolName, input },
    });
    const created = await deps.prisma.interactiveSurface.create({
      data: {
        guildId: ctx.guildId,
        channelId: ctx.channelId,
        kind: 'confirm',
        definition: JSON.stringify(definition),
        state: JSON.stringify(definition.initialState),
        createdBy: ctx.userId,
      },
    });
    await deps.renderSurface(created.id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Porte de confirmation des actions destructives (règle serveur
 * confirmDestructiveActions). Ses dépendances sont liées au boot par les
 * providers propriétaires : elles vivaient dans des classes de MODULE, que le
 * framework n'instancie jamais, et la porte ne s'était donc jamais fermée.
 */
export class DestructiveConfirmationGate {
  constructor(
    private readonly deps: () => RegistryRuntimeDeps,
    private readonly audit: AuditService,
  ) {}

  /**
   * Refus à relayer quand l'action destructive doit être confirmée par un
   * clic, null si l'exécution peut continuer (règle inactive ou accord déjà donné).
   */
  async refuseUnlessApproved(name: string, input: unknown, ctx: ToolRunContext): Promise<ToolResult | null> {
    const deps = this.deps();
    if (!ctx.guildId || !deps.rules || !deps.cache) return null;
    const rulesOn = (await deps.rules.get(ctx.guildId)).confirmDestructiveActions;
    const confirmKey = confirmKeyFor(ctx.guildId, name, input);
    if (!rulesOn || (await deps.cache.active.get(confirmKey)) === 'ok') return null;

    const posted = await postConfirmSurface(name, input, ctx, deps).catch(() => false);
    this.audit.record({
      guildId: ctx.guildId,
      source: 'agent',
      action: 'rule.confirm.shown',
      actorId: ctx.userId,
      metadata: { tool: name, posted },
    });
    return {
      ok: false,
      summary: `Action destructive (${name}) bloquée par la règle du serveur : ${
        posted
          ? `les boutons ✅ Confirmer / ❌ Annuler viennent d\u0027être postés (réservés à <@${ctx.userId}>, valides 5 min). Informe l\u0027utilisateur, puis RE-EXÉCUTE le tool après son clic ✅.`
          : 'confirmation par boutons requise mais impossible à afficher ici. Demande une confirmation explicite à l\u0027utilisateur puis re-exécute.'
      }`,
    };
  }
}
