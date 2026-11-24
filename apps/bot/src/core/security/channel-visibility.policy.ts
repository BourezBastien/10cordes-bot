import type { GuildBasedChannel, GuildMember } from 'discord.js';
import { memberPermissionPolicy } from './member-permission.policy';
import { permissionNamesPolicy } from './permission-names.policy';

/**
 * Policy « ce membre voit-il ce salon ? ». Un tool de lecture qui liste des
 * salons ne doit montrer à un membre que ceux qu'il peut voir lui-même :
 * le bot voit plus que le demandeur (salons staff, salons privés), et son
 * résultat ne doit pas lui révéler ce que Discord lui cache.
 */

export class ChannelVisibilityPolicy {
  readonly policyName = 'ChannelVisibility';

  /** Le membre voit-il ce salon ? (ViewChannel, overwrites compris ; l'administrateur et le propriétaire voient tout) */
  visibleTo(member: GuildMember | null | undefined, channel: GuildBasedChannel | null | undefined): boolean {
    return memberPermissionPolicy.hasIn(member, channel, 'ViewChannel');
  }

  /** Parmi ces salons, ceux que le membre voit ; les autres ne sont ni nommés ni comptés. */
  visibleOnly<T extends { id: string }>(
    member: GuildMember | null | undefined,
    channels: readonly T[],
    resolve: (channel: T) => GuildBasedChannel | null | undefined,
  ): T[] {
    return channels.filter((channel) => this.visibleTo(member, resolve(channel)));
  }

  /**
   * Un demandeur qui n'est PAS un membre du serveur (le webhook du rig E2E,
   * qui parle en staff) n'a pas de permissions de salon à lire. Il voit tout
   * si et seulement si la liste de permissions qu'on lui connaît porte
   * Administrator ; sinon rien. Un vrai membre ne passe jamais par ici.
   */
  visibleWithoutMember(permissionNames: readonly string[]): boolean {
    return permissionNamesPolicy.isAdmin(permissionNames);
  }
}

/** Instance singleton (la policy est sans état). */
export const channelVisibilityPolicy = new ChannelVisibilityPolicy();
