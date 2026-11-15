import type { SpraxiumException } from '@spraxium/core';
import type { ExecutionContext } from '@spraxium/common';
import { renderTemplate, type TemplateVars } from '@10cordes/shared';
import { getConfigServiceForLayout } from './guild-config.service';

/**
 * Layout d'erreurs par défaut — personnalisation PAR SERVEUR via
 * `errorMessages` de la guild config (clé = code de l'exception, valeur =
 * template avec les placeholders de l'exception).
 */
export class GuildErrorLayout {
  async build(exception: SpraxiumException, ctx: ExecutionContext): Promise<{ content: string; ephemeral: true }> {
    const guildId = ctx.getGuildId();
    if (guildId) {
      try {
        const config = await getConfigServiceForLayout().get(guildId);
        const custom = config.errorMessages[exception.code];
        if (custom) {
          return { content: renderTemplate(custom, exception.props as TemplateVars), ephemeral: true };
        }
      } catch {
        // La config est un bonus — jamais un blocage pour afficher l'erreur.
      }
    }
    return { content: exception.message, ephemeral: true };
  }
}
