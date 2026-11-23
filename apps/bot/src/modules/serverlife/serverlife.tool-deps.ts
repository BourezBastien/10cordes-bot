import type { Client, Guild } from 'discord.js';
import type { PrismaService } from '../database/prisma.service';
import type { ServerlifeStore } from './serverlife.store';

/** Ce dont les tools de vie de serveur ont besoin pour s'exécuter. */
export interface ServerlifeToolsDeps {
  readonly client: Client;
  readonly prisma: PrismaService;
  /** État volatile du module : snipe, état pré-lockdown, compteur d'activité. */
  readonly store: ServerlifeStore;
  /** Serveur de la demande (null hors serveur). */
  readonly guildOf: (ctx: { guildId: string | null }) => Guild | null;
}
