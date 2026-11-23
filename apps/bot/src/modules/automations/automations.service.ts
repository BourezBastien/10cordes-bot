import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client } from 'discord.js';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AutomationExecutor } from './automations.executor';
import { TRIGGER_TYPES, type AgentAutomationRow, type AutomationEventContext } from './automations.schemas';
import { buildAutomationTools } from './automations.tools';

/**
 * Automatisations créées par l'agent (décision produit skills-first) :
 * event Discord → filtres → actions. Le bot les construit à la demande
 * (« quand un ticket s'ouvre, mentionne le staff »), les listeners exécutent.
 *
 * Gates en code : création/liste/suppression ManageGuild ; à l'exécution,
 * chaque action re-vérifie les permissions du BOT (SendMessages/ManageRoles).
 * Variables de template : {{user}}, {{user.name}}, {{server}}, {{count}}.
 *
 * Répartition : AutomationsService (boot, cache des automatisations actives,
 * filtres, point d'entrée des listeners), AutomationExecutor (exécution des
 * actions), automations.schemas.ts (contrat), automations.tools.ts
 * (primitives createAutomation/listAutomations/deleteAutomation).
 */

// Contrat ré-exporté : ces trois symboles étaient exportés par ce fichier
// avant le découpage. L'API publique du service ne change pas.
export { ActionSchema, type AgentAutomationRow, type AutomationEventContext } from './automations.schemas';

@Injectable()
export class AutomationsService implements SpraxiumOnBoot {
  private readonly log = new Logger('Automations');
  /** Cache des automatisations actives par serveur (TTL 30s). */
  private readonly cache = new Map<string, { rows: AgentAutomationRow[]; fetchedAt: number }>();
  // Collaborateur non injectable : champ de classe, branché dans le constructeur.
  private readonly executor: AutomationExecutor;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly client: Client,
  ) {
    this.executor = new AutomationExecutor(client, audit, this.log);
  }

  onBoot(): void {
    // Le ToolRegistryModule est déjà chargé au premier boot transitif : le
    // registry s'obtient via l'accesseur runtime (pas d'injection DI).
    const registry = getToolRegistry();
    const tools = buildAutomationTools({ prisma: this.prisma, audit: this.audit, invalidate: (guildId) => this.invalidate(guildId) });
    for (const tool of tools) registry.register(tool);
  }

  private async invalidate(guildId: string): Promise<void> {
    this.cache.delete(guildId);
  }

  private async activeFor(guildId: string, triggerType: string): Promise<AgentAutomationRow[]> {
    const cached = this.cache.get(guildId);
    if (!cached || Date.now() - cached.fetchedAt > 30_000) {
      // Fetch NON filtré par triggerType : le cache est partagé par TOUS les
      // triggers du serveur. (Bug fix : filtrer à l'écriture rendait les
      // autres triggers invisibles pendant tout le TTL — une automatisation
      // member.joined ne se déclenchait jamais après un message.created.)
      const rows = (await this.prisma.agentAutomation.findMany({
        where: { guildId, enabled: true },
        orderBy: { createdAt: 'asc' },
      })) as AgentAutomationRow[];
      this.cache.set(guildId, { rows, fetchedAt: Date.now() });
      return rows.filter((row) => row.triggerType === triggerType);
    }
    return cached.rows.filter((row) => row.triggerType === triggerType);
  }

  /** Filtres : channelId (salon concerné) et contains (sous-chaîne du contenu). */
  private matchesFilter(row: AgentAutomationRow, ctx: AutomationEventContext, content?: string): boolean {
    let filter: { channelId?: string; contains?: string } = {};
    try {
      filter = JSON.parse(row.triggerFilter ?? '{}');
    } catch {
      /* filtre vide */
    }
    if (filter.channelId && filter.channelId !== ctx.channelId) return false;
    if (filter.contains && (!content || !content.toLowerCase().includes(filter.contains.toLowerCase()))) return false;
    return true;
  }

  /** Point d'entrée des listeners : exécute toutes les automatisations qui matchent. */
  async handleEvent(triggerType: (typeof TRIGGER_TYPES)[number], ctx: AutomationEventContext, content?: string): Promise<void> {
    const rows = await this.activeFor(ctx.guildId, triggerType);
    for (const row of rows) {
      if (!this.matchesFilter(row, ctx, content)) continue;
      await this.executor.executeActions(row, ctx);
    }
  }
}
