import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { DASHBOARD_EVENT_TYPES, type DashboardEvent, type DashboardEventType } from '@10cordes/shared';
// AuditService en import de VALEUR : c'est le jeton d'injection du constructeur (un import type donnerait Object).
import { AuditService, type AuditEntry } from '../audit/audit.service';

/** Un abonné du flux temps réel : la fonction qui lui pousse un événement. */
export type EventSink = (event: DashboardEvent) => void;

interface Subscription {
  guildId: string;
  sink: EventSink;
}

/** Famille d'une action d'audit, par son préfixe. */
function familyOf(action: string): string {
  return action.split('.')[0] ?? '';
}

/**
 * Ce qu'une action d'audit fait rafraîchir sur le dashboard. Un changement
 * vient autant du salon `config-bot` (outils du bot) que du dashboard : les
 * deux passent par l'audit.
 */
const EVENT_OF_FAMILY: Readonly<Record<string, DashboardEventType>> = {
  provider: 'provider.updated',
  capability: 'capability.updated',
  integration: 'integration.updated',
  instance: 'integration.updated',
  webhook: 'webhook.updated',
  rules: 'rules.updated',
};

/** Type d'événement qu'une entrée d'audit déclenche, ou null si elle ne concerne pas le panel. */
export function dashboardEventOf(entry: Pick<AuditEntry, 'action' | 'guildId'>): DashboardEvent | null {
  if (!entry.guildId) return null;
  const type = EVENT_OF_FAMILY[familyOf(entry.action)];
  return type ? { type } : null;
}

/**
 * Temps réel du panel : un crochet sur l'audit distribue aux flux ouverts du
 * serveur concerné un événement qui ne dit RIEN que son type. Le dashboard
 * relit ensuite ce qu'il a le droit de lire ; rien d'un autre serveur, aucun
 * identifiant, aucun contenu ne passe ici.
 *
 * En mémoire : les flux d'un seul processus. Le bot en lance un seul ; un
 * déploiement en plusieurs processus ne se propagerait pas entre eux.
 */
@Injectable()
export class DashboardEventsService implements SpraxiumOnBoot {
  private readonly log = new Logger('DashboardEvents');
  private readonly subscriptions: Subscription[] = [];
  private unsubscribeAudit: (() => void) | null = null;

  constructor(private readonly audit: AuditService) {}

  onBoot(): void {
    this.unsubscribeAudit?.();
    this.unsubscribeAudit = this.audit.onRecord((entry) => {
      const event = dashboardEventOf(entry);
      if (event) this.publish(entry.guildId ?? '', event);
    });
    this.log.info(`DashboardEvents ready (${DASHBOARD_EVENT_TYPES.length} types d\u0027événement).`);
  }

  /** Abonne un flux du serveur ; rend la fonction qui le retire. */
  subscribe(guildId: string, sink: EventSink): () => void {
    const subscription: Subscription = { guildId, sink };
    this.subscriptions.push(subscription);
    return () => {
      const index = this.subscriptions.indexOf(subscription);
      if (index >= 0) this.subscriptions.splice(index, 1);
    };
  }

  /** Flux ouverts d'un serveur (diagnostic). */
  subscriberCount(guildId: string): number {
    return this.subscriptions.filter((subscription) => subscription.guildId === guildId).length;
  }

  private publish(guildId: string, event: DashboardEvent): void {
    for (const subscription of [...this.subscriptions]) {
      if (subscription.guildId !== guildId) continue;
      try {
        subscription.sink(event);
      } catch (error) {
        this.log.warn(`flux temps réel du serveur ${guildId} interrompu : ${(error as Error).message.slice(0, 120)}`);
      }
    }
  }
}
