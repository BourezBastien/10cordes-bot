import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { ChannelType, Client, type Guild, type ThreadChannel } from 'discord.js';
import { z } from 'zod';
import { defineTool, type BotTool } from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { getGuildRules } from '../rules/guild-rules.runtime';
import { getIntegrations } from '../integrations/integration.runtime';
import { getLlm } from '../assistant/llm.accessor';
import { fileLog } from '../logging/file-log.service';
import { AgentSettingsService } from './agent-settings.service';
import { ConfigPanelPresenter, type ConfigPanelView } from './presenters/config-panel.presenter';

const CONFIG_THREAD_NAME = '⚙️┃config-bot';
const TOP_SKILLS = 8;

/**
 * Fil de configuration PRIVÉ (⚙️┃config-bot) + tools de vue.
 *
 * Produit (retour owner 23/11) : une demande de « configuration » ne liste
 * JAMAIS les 135 blueprints ni la vieille config morte - elle montre ce qui
 * est réellement APPLIQUÉ sur CE serveur : règles (GuildRule), skills actifs,
 * intégrations connectées + modèles (jamais les clés), mode thinking.
 */
@Injectable()
export class ConfigThreadService implements SpraxiumOnBoot {
  private readonly log = new Logger('ConfigThread');
  private readonly presenter = new ConfigPanelPresenter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: Client,
    private readonly agentSettings: AgentSettingsService,
  ) {}

  onBoot(): void {
    getToolRegistry().register(this.configPanelTool());
    getToolRegistry().register(this.serverOverviewTool());
    getToolRegistry().register(this.thinkingModeTool());
    this.log.info('Config ready (config.panel / server.overview / config.thinking).');
  }

  /** Assemble la vue de configuration d'un serveur (aucune clé). */
  async buildView(guild: Guild): Promise<ConfigPanelView> {
    // GuildRules/Integrations résolus au MOMENT de l'appel via accesseurs
    // runtime : ce module se charge avant les leurs (pattern getLlm).
    const [ruleLines, skills, settings, llmStatus] = await Promise.all([
      getGuildRules().describeForPrompt(guild.id),
      this.prisma.agentSkill.findMany({
        where: { guildId: guild.id, deletedAt: null },
        select: { trigger: true, usageCount: true },
        orderBy: { usageCount: 'desc' },
      }),
      this.agentSettings.get(guild.id),
      Promise.resolve(getLlm().status()),
    ]);

    const integrationIds = ['llm', 'pixellab', 'kie'] as const;
    const integrations = await Promise.all(
      integrationIds.map(async (id) => {
        const status = await getIntegrations().status(id).catch(() => null);
        return {
          label: status?.label ?? id,
          connected: Boolean(status?.maskedKey),
          model: status?.model ?? null,
        };
      }),
    );

    return {
      guildName: guild.name,
      rulesLines: ruleLines,
      skills: {
        total: skills.length,
        top: skills.slice(0, TOP_SKILLS).map((skill) => ({ trigger: skill.trigger, uses: skill.usageCount })),
      },
      integrations,
      llm: {
        connected: llmStatus.source !== 'none',
        model: llmStatus.model,
        source: llmStatus.source === 'modal' ? 'modal' : llmStatus.source === 'env' ? 'env' : 'none',
      },
      thinkingMode: settings.thinkingMode,
      threadCreated: settings.configThreadId !== null,
    };
  }

  /** Crée (ou réutilise) le fil privé config-bot et y poste le panneau. */
  async postPanel(guild: Guild): Promise<string> {
    const settings = await this.agentSettings.get(guild.id);
    let threadId = settings.configThreadId;

    let thread: ThreadChannel | null = threadId
      ? ((await this.client.channels.fetch(threadId).catch(() => null)) as ThreadChannel | null)
      : null;
    if (!thread || !('send' in thread)) {
      // guild.channels.create ne crée pas de threads : on repart d'un salon
      // texte système (celui du canal de demande n'est pas disponible ici,
      // on utilise le premier salon texte où le bot peut écrire).
      const parent = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText);
      if (!parent) throw new Error('aucun salon texte trouvé pour héberger le fil');
      const created = await (parent as { threads: { create: (opts: unknown) => Promise<ThreadChannel> } }).threads.create({
        name: CONFIG_THREAD_NAME,
        type: ChannelType.PrivateThread,
        reason: 'Fil de configuration privé du bot (owner + admins)',
      });
      thread = created;
      threadId = created.id;
      await this.agentSettings.patch(guild.id, { configThreadId: threadId });
      fileLog()?.event('info', 'config', 'thread_created', { guildId: guild.id, threadId });
    }

    const view = await this.buildView(guild);
    // Payload COMPLET construit par le Presenter (flags inclus) : le service
    // ne touche à aucun builder/flag Discord (règle UI_IN_SERVICE stricte).
    await thread.send(this.presenter.renderComplete(view) as never);
    return `<#${threadId}>`;
  }

  private configPanelTool(): BotTool {
    const service = this;
    return defineTool({
      name: 'config.panel',
      description:
        'Ouvre (ou met à jour) le fil privé ⚙️┃config-bot : panneau V2 de CE qui est appliqué sur ce serveur — règles actives, skills appliqués, intégrations connectées avec leurs modèles (jamais les clés), mode thinking. C\u0027est LA réponse à « montre-moi la configuration ».',
      category: 'guild-config',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'Pour toute question « quelle est ta configuration / qu\u0027as-tu activé ici » : appelle ce tool et résume le panneau en 2-3 phrases. NE liste JAMAIS les blueprints du catalogue ni les sections de config legacy (welcome/tickets/levels...) : seul ce qui est APPLIQUÉ compte.',
      handler: async (_input, ctx) => {
        const guild = service.client.guilds.cache.get(ctx.guildId ?? '');
        if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
        try {
          const link = await service.postPanel(guild);
          return { ok: true, summary: `Panneau de configuration posté dans ${link} (fil privé staff).` };
        } catch (error) {
          return { ok: false, summary: `Impossible de créer le fil : ${(error as Error).message.slice(0, 120)}` };
        }
      },
    });
  }

  private serverOverviewTool(): BotTool {
    const service = this;
    return defineTool({
      name: 'server.overview',
      description:
        'Vue conversationnelle de la configuration appliquée sur ce serveur : règles actives, nombre de skills + top utilisés, intégrations connectées + modèles, mode thinking. Sans clés. Complément léger de config.panel (qui poste le panneau V2 dans le fil privé).',
      category: 'guild-config',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only. Répond en liste courte. Pour « présente ta config » préfère ce tool ; pour un panneau cliquable, config.panel.',
      handler: async (_input, ctx) => {
        const guild = service.client.guilds.cache.get(ctx.guildId ?? '');
        if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
        const view = await service.buildView(guild);
        const lines = [
          `Règles : ${view.rulesLines.length > 0 ? `${view.rulesLines.length} active(s)` : 'aucune (mention stricte par défaut)'}`,
          `Skills appliqués : ${view.skills.total}`,
          `Intégrations : ${view.integrations.map((integration) => `${integration.label} ${integration.connected ? 'ON' : 'off'}`).join(', ')}`,
          `Agent IA : ${view.llm.connected ? `modèle ${view.llm.model ?? 'défaut'} (${view.llm.source})` : 'non connecté'} · thinking ${view.thinkingMode}`,
        ];
        return { ok: true, summary: lines.join(' · ') };
      },
    });
  }

  private thinkingModeTool(): BotTool {
    const service = this;
    return defineTool({
      name: 'config.thinking',
      description:
        'Règle le mode thinking du modèle pour ce serveur : adaptive (défaut - thinking activé SEULEMENT pendant l\u0027exécution de tools/compétences, off en conversation simple et en synthèse finale), always, off.',
      category: 'guild-config',
      paramsSchema: z.object({
        mode: z.enum(['adaptive', 'always', 'off']).describe('adaptive = recommandé (économique et rapide en simple conversation)'),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Changement de réglage local au serveur, effet immédiat.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        await service.agentSettings.patch(ctx.guildId, { thinkingMode: input.mode });
        return { ok: true, summary: `Thinking du serveur réglé sur ${input.mode}.` };
      },
    });
  }
}
