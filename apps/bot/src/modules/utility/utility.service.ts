import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client } from 'discord.js';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { PrismaService } from '../database/prisma.service';
import { UtilityResolver } from './utility-resolver';
import { buildUtilityTools, type UtilityToolsDeps } from './utility.tools';

/**
 * Utilities roundup : exports (messages/membres), recherche d'historique,
 * événements Discord natifs, posts forum/fils, pins, annonces webhook,
 * réactions. Tools indépendants, tous permission-gated.
 *
 * Répartition : utility-resolver.ts (résolution du serveur et du salon depuis
 * le cache), utility-*.tools.ts (définitions des tools), utility.tools.ts
 * (assemblage dans l'ordre d'enregistrement). Le service les enregistre au
 * boot, rien de plus.
 */
@Injectable()
export class UtilityService implements SpraxiumOnBoot {
  private readonly log = new Logger('Utility');
  // Collaborateur non injectable : champ de classe, jamais un paramètre de constructeur DI.
  private readonly resolver: UtilityResolver;

  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaService,
  ) {
    this.resolver = new UtilityResolver(this.client);
  }

  onBoot(): void {
    const deps: UtilityToolsDeps = { client: this.client, resolver: this.resolver };
    for (const tool of buildUtilityTools(deps)) getToolRegistry().register(tool);
    this.log.info(`${buildUtilityTools(deps).length} tools utility enregistrés.`);
  }
}
