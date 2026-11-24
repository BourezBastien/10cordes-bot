import { describe, expect, it, vi } from 'vitest';
import { Collection, ComponentType, MessageFlags, PermissionsBitField, type GuildMember } from 'discord.js';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import type { PermissionName } from '../../core/security/permission-name';
import { ActionPlanService } from './action-plan.service';

/**
 * Revue AVANT l'affichage d'un plan. On ne demande pas d'approuver ce qui
 * serait refusé au clic : une action que le demandeur ne peut pas exécuter
 * (permission de l'outil, permission dans le salon visé, salon introuvable)
 * est écartée du plan, et le panneau le dit. Sans demandeur résolu dans le
 * serveur (webhook du rig, lecture en erreur), tout est proposé : la revue
 * aura lieu au clic.
 */

const GUILD = '1550000000000000001';
const OWNER = '1550000000000000002';
const CHANNEL = '1550000000000000003';
const USER = '1550000000000000004';
/** Salon où le demandeur n'a pas le droit d'écrire (overwrite). */
const MUTED_CHANNEL = '1550000000000000098';
const GONE_CHANNEL = '1550000000000000099';

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';
const RENAME = 'renameChannel';
const RULES = 'rules.set';
const REMOVE = 'deleteChannel';
const SEND = 'sendMessage';
const TOOLS: Record<string, BotTool> = {
  [RENAME]: { [NAME]: RENAME, permissions: ['ManageChannels'] } as unknown as BotTool,
  [RULES]: { [NAME]: RULES, permissions: ['ManageGuild'] } as unknown as BotTool,
  [REMOVE]: { [NAME]: REMOVE, permissions: ['ManageChannels'] } as unknown as BotTool,
  [SEND]: { [NAME]: SEND, permissions: ['SendMessages'] } as unknown as BotTool,
};

type Row = { id: string; guildId: string; channelId: string; messageId: string | null; kind: string; definition: string; state: string; createdBy: string };
type Component = { type?: number; content?: string; components?: Component[] };
type Payload = { flags?: number; components?: Array<{ toJSON: () => { components: Component[] } }> };

const ctxOf = (): ToolRunContext => ({ guildId: GUILD, channelId: CHANNEL, userId: USER, locale: 'fr', permissions: ['ManageChannels', 'ManageGuild', 'SendMessages'], reply: async () => undefined });

/** Serveur factice ; le demandeur y est rechargé (members.fetch) avec les permissions données. */
function fakeGuild(flags: PermissionName[]) {
  const guild = {
    id: GUILD,
    ownerId: OWNER,
    members: { cache: new Collection<string, GuildMember>(), fetch: vi.fn() },
    roles: { cache: new Collection<string, unknown>() },
    channels: {
      cache: new Collection<string, unknown>([
        [CHANNEL, { id: CHANNEL, permissionsFor: () => new PermissionsBitField(flags) }],
        // Overwrite du salon : le demandeur n'y a plus le droit d'écrire.
        [MUTED_CHANNEL, { id: MUTED_CHANNEL, permissionsFor: () => new PermissionsBitField(flags.filter((flag) => flag !== 'SendMessages')) }],
      ]),
    },
  };
  guild.members.fetch.mockResolvedValue({
    id: USER,
    guild,
    permissions: new PermissionsBitField(flags),
    roles: { cache: new Collection<string, unknown>() },
    isCommunicationDisabled: () => false,
  } as unknown as GuildMember);
  return guild;
}

function harness(flags: PermissionName[] = ['ManageChannels', 'ManageGuild', 'SendMessages'], withGuild = true) {
  const rows: Row[] = [];
  let sequence = 0;
  const surface = {
    create: vi.fn(async ({ data }: { data: Omit<Row, 'id' | 'messageId'> }) => {
      const row: Row = { id: `plan${++sequence}`, messageId: null, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async () => ({ id: 'plan1' })),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((entry) => entry.id === where.id) ?? null),
    findMany: vi.fn(async () => [] as Row[]),
  };
  const channel = { isTextBased: () => true, send: vi.fn(async (_payload: Payload) => ({ id: 'msg-1' })) };
  const guild = fakeGuild(flags);
  const client = { channels: { cache: new Map([[CHANNEL, channel]]) }, guilds: { cache: new Map(withGuild ? [[GUILD, guild]] : []) } };
  const audit = { record: vi.fn() };
  const registry = {
    get: vi.fn((label: string): BotTool | undefined => TOOLS[label]),
    run: vi.fn(async (): Promise<ToolResult> => ({ ok: true, summary: 'fait' })),
  };
  const service = new ActionPlanService({ interactiveSurface: surface } as never, audit as never, client as never, registry as never);
  /** Composants du premier message envoyé (le panneau), séparateurs compris. */
  const components = (): Component[] => {
    const payload = channel.send.mock.calls[0]?.[0] as Payload | undefined;
    return payload?.components?.[0]?.toJSON().components ?? [];
  };
  /** Textes du panneau envoyé, dans l'ordre (séparateurs et boutons exclus). */
  const texts = (): string[] => components().filter((part) => part.type === ComponentType.TextDisplay).map((part) => part.content ?? '');
  const auditRows = (): Array<{ action: string; metadata: Record<string, unknown> }> => audit.record.mock.calls.map(([row]) => row);
  return { rows, surface, channel, client, audit, registry, service, components, texts, auditRows, fetchMember: guild.members.fetch };
}

describe('ActionPlanService · revue avant affichage', () => {
  it('une action dont le demandeur n\u0027a pas la permission est écartée du plan, et le panneau le dit', async () => {
    const h = harness(['ManageChannels', 'SendMessages']);
    h.service.stage(ctxOf(), RENAME, { channelId: CHANNEL, name: 'général' });
    h.service.stage(ctxOf(), RULES, { strictMentionElsewhere: true });

    const plan = await h.service.flush(GUILD, USER);
    expect(h.fetchMember).toHaveBeenCalledWith({ user: USER, force: true });
    expect(plan).toMatchObject({
      actions: [{ tool: RENAME, input: { channelId: CHANNEL, name: 'général' } }],
      dropped: [{ tool: RULES, reason: 'permission requise : ManageGuild' }],
      messageId: 'msg-1',
    });
    expect(h.texts()).toEqual([
      '## Confirmer les actions (hors lecture)',
      expect.stringContaining(`Demande de <@${USER}>`),
      '1. **renameChannel** · channelId=1550000000000000003, name=général',
      '-# Écartée (le demandeur ne peut pas l\u0027exécuter) : **rules.set** · permission requise : ManageGuild',
      expect.stringContaining('Seul l\u0027auteur de la demande'),
    ]);
    expect(h.channel.send.mock.calls[0]?.[0]).toMatchObject({ flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    expect(h.auditRows().find((row) => row.action === 'plan.posted')?.metadata).toMatchObject({ actions: 1, dropped: 1 });
  });

  it('un salon visé introuvable écarte l\u0027action : on ne propose pas d\u0027approuver un refus certain', async () => {
    const h = harness();
    h.service.stage(ctxOf(), REMOVE, { channelId: GONE_CHANNEL });
    h.service.stage(ctxOf(), RENAME, { channelId: CHANNEL, name: 'général' });
    const plan = await h.service.flush(GUILD, USER);
    expect(plan).toMatchObject({ actions: [{ tool: RENAME }], dropped: [{ tool: REMOVE, reason: 'salon introuvable' }] });
  });

  it('la permission manque dans le salon visé (overwrite) : écartée, avec la permission et le salon en cause', async () => {
    const h = harness();
    h.service.stage(ctxOf(), SEND, { channelId: MUTED_CHANNEL, content: 'bonjour' });
    h.service.stage(ctxOf(), SEND, { channelId: CHANNEL, content: 'bonjour' });
    const plan = await h.service.flush(GUILD, USER);
    expect(plan).toMatchObject({
      actions: [{ tool: SEND, input: { channelId: CHANNEL, content: 'bonjour' } }],
      dropped: [{ tool: SEND, reason: 'permission manquante dans ce salon : SendMessages' }],
    });
  });

  it('quand aucune action ne survit : pas de plan, un avis sans bouton, et une trace', async () => {
    const h = harness(['ManageChannels']);
    h.service.stage(ctxOf(), RULES, { seriousOnlyElsewhere: true });

    await expect(h.service.flush(GUILD, USER)).resolves.toBeNull();
    expect(h.surface.create).not.toHaveBeenCalled();
    expect(h.texts()).toEqual([
      '## Rien à confirmer',
      '-# Écartée (le demandeur ne peut pas l\u0027exécuter) : **rules.set** · permission requise : ManageGuild',
      '-# Aucune action n\u0027a été proposée ni exécutée. Une de ces actions te semble due : passe par le staff.',
    ]);
    expect(h.components().filter((part) => part.type === ComponentType.ActionRow)).toEqual([]);
    expect(h.auditRows()).toEqual([
      { guildId: GUILD, source: 'agent', action: 'plan.rejected', actorId: USER, metadata: { dropped: ['rules.set : permission requise : ManageGuild'] } },
    ]);
  });

  it('sans demandeur résolu dans le serveur (webhook du rig) : tout est proposé, la revue aura lieu au clic', async () => {
    const noGuild = harness(['ManageChannels'], false);
    noGuild.service.stage(ctxOf(), RULES, { seriousOnlyElsewhere: true });
    expect(await noGuild.service.flush(GUILD, USER)).toMatchObject({ actions: [{ tool: RULES, input: { seriousOnlyElsewhere: true } }], dropped: [] });

    const unreadable = harness(['ManageChannels']);
    unreadable.fetchMember.mockRejectedValue(new Error('membre illisible'));
    unreadable.service.stage(ctxOf(), RULES, { seriousOnlyElsewhere: true });
    expect(await unreadable.service.flush(GUILD, USER)).toMatchObject({ actions: [{ tool: RULES }], dropped: [] });
  });

  it('ce que le demandeur peut tout exécuter : rien n\u0027est écarté, le panneau n\u0027en parle pas', async () => {
    const h = harness();
    h.service.stage(ctxOf(), RENAME, { channelId: CHANNEL, name: 'général' });
    h.service.stage(ctxOf(), RULES, { strictMentionElsewhere: true });
    expect(await h.service.flush(GUILD, USER)).toMatchObject({ actions: [{ tool: RENAME }, { tool: RULES }], dropped: [] });
    expect(h.texts().some((line) => line.includes('Écartée'))).toBe(false);
  });
});
