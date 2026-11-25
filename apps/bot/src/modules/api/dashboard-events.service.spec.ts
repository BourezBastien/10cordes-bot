import { describe, expect, it, vi } from 'vitest';
import { DASHBOARD_EVENT_TYPES, DashboardEventSchema } from '@10cordes/shared';
import type { AuditEntry } from '../audit/audit.service';
import { DashboardEventsService, dashboardEventOf } from './dashboard-events.service';

/**
 * Temps réel du panel : un crochet sur l'audit distribue aux flux ouverts du
 * serveur concerné un événement TYPÉ qui ne dit rien que son type. Rien d'un
 * autre serveur, aucun identifiant, aucun contenu ne passe ici.
 */

const GUILD = '1550000000000000001';
const OTHER = '1550000000000000008';

function mount() {
  let listener: ((entry: AuditEntry) => void) | null = null;
  const unsubscribe = vi.fn();
  const audit = {
    onRecord: vi.fn((received: (entry: AuditEntry) => void) => {
      listener = received;
      return unsubscribe;
    }),
  };
  const service = new DashboardEventsService(audit as never);
  service.onBoot();
  const emit = (action: string, guildId: string | null = GUILD): void => {
    listener?.({ action, guildId, source: 'api', actorId: null, targetId: null, metadata: { apiKey: 'jamais transmis' } } as AuditEntry);
  };
  return { service, audit, unsubscribe, emit };
}

describe('dashboardEventOf', () => {
  it('chaque famille d\u0027audit qui intéresse le panel a son type d\u0027événement', () => {
    expect(dashboardEventOf({ action: 'provider.upserted', guildId: GUILD })).toEqual({ type: 'provider.updated' });
    expect(dashboardEventOf({ action: 'provider.tested', guildId: GUILD })).toEqual({ type: 'provider.updated' });
    expect(dashboardEventOf({ action: 'capability.bound', guildId: GUILD })).toEqual({ type: 'capability.updated' });
    expect(dashboardEventOf({ action: 'integration.upserted', guildId: GUILD })).toEqual({ type: 'integration.updated' });
    expect(dashboardEventOf({ action: 'instance.imported', guildId: GUILD })).toEqual({ type: 'integration.updated' });
    expect(dashboardEventOf({ action: 'webhook.created', guildId: GUILD })).toEqual({ type: 'webhook.updated' });
    expect(dashboardEventOf({ action: 'rules.updated', guildId: GUILD })).toEqual({ type: 'rules.updated' });
  });

  it('ce qui ne concerne pas le panel, ou qui n\u0027est pas d\u0027un serveur, ne donne rien', () => {
    expect(dashboardEventOf({ action: 'module.enable', guildId: GUILD })).toBeNull();
    expect(dashboardEventOf({ action: 'assistant.tool.records.list', guildId: GUILD })).toBeNull();
    expect(dashboardEventOf({ action: 'provider.upserted', guildId: null })).toBeNull();
  });

  it('tout événement produit est du type du contrat, et connu du flux', () => {
    for (const action of ['provider.x', 'capability.x', 'integration.x', 'instance.x', 'webhook.x', 'rules.x']) {
      const event = dashboardEventOf({ action, guildId: GUILD });
      expect(event, action).not.toBeNull();
      expect(DashboardEventSchema.safeParse(event).success, action).toBe(true);
      expect(DASHBOARD_EVENT_TYPES, action).toContain(event?.type);
    }
  });
});

describe('DashboardEventsService', () => {
  it('s\u0027accroche à l\u0027audit au démarrage, et ne s\u0027y accroche qu\u0027une fois', () => {
    const { audit, service, unsubscribe } = mount();
    expect(audit.onRecord).toHaveBeenCalledTimes(1);
    service.onBoot();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(audit.onRecord).toHaveBeenCalledTimes(2);
  });

  it('un abonné ne reçoit que les événements de SON serveur, et seulement le type', () => {
    const { service, emit } = mount();
    const mine = vi.fn();
    const theirs = vi.fn();
    const stop = service.subscribe(GUILD, mine);
    service.subscribe(OTHER, theirs);
    emit('provider.upserted');
    emit('rules.updated', OTHER);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(mine).toHaveBeenCalledWith({ type: 'provider.updated' });
    expect(Object.keys(mine.mock.calls[0]?.[0] ?? {})).toEqual(['type']);
    expect(theirs).toHaveBeenCalledTimes(1);
    expect(theirs).toHaveBeenCalledWith({ type: 'rules.updated' });
    expect(service.subscriberCount(GUILD)).toBe(1);
    stop();
    stop();
    expect(service.subscriberCount(GUILD)).toBe(0);
    emit('provider.upserted');
    expect(mine).toHaveBeenCalledTimes(1);
  });

  it('un flux qui lève n\u0027interrompt ni les autres flux ni l\u0027audit', () => {
    const { service, emit } = mount();
    const broken = vi.fn(() => {
      throw new Error('flux coupé');
    });
    const sane = vi.fn();
    service.subscribe(GUILD, broken);
    service.subscribe(GUILD, sane);
    expect(() => emit('webhook.created')).not.toThrow();
    expect(broken).toHaveBeenCalledTimes(1);
    expect(sane).toHaveBeenCalledTimes(1);
  });
});
