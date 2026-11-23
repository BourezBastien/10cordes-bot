import type { ComponentButtonAction } from '@10cordes/shared';
import type { PrismaService } from '../database/prisma.service';
import type { ComponentActionContext } from '../../shared/actions/registry';

/**
 * Exécuteur de l'action de composant « counter » : incrémente un compteur
 * nommé de la collection native « counters » (un enregistrement par nom et par
 * serveur) et renvoie la ligne à afficher.
 */
export function counterActionExecutor(prisma: PrismaService) {
  return async (action: ComponentButtonAction, ctx: ComponentActionContext): Promise<string> => {
    if (action.type !== 'counter') return 'Action inattendue.';
    if (!ctx.guildId) return 'Contexte de serveur requis.';
    const name = action.name;
    const rows = await prisma.agentRecord.findMany({
      where: { guildId: ctx.guildId, collection: 'counters' },
    });
    const existing = rows.find((row) => {
      try {
        return (JSON.parse(row.data) as { name?: string }).name === name;
      } catch {
        return false;
      }
    });
    if (existing) {
      const current = JSON.parse(existing.data) as { value?: number };
      const value = (current.value ?? 0) + 1;
      await prisma.agentRecord.update({
        where: { id: existing.id },
        data: { data: JSON.stringify({ version: 1, name, value }) },
      });
      return `**${name}** : ${value}.`;
    }
    await prisma.agentRecord.create({
      data: {
        guildId: ctx.guildId,
        collection: 'counters',
        channelId: ctx.channelId,
        messageId: ctx.messageId,
        createdBy: ctx.userId ?? ctx.member?.id ?? 'anonyme',
        data: JSON.stringify({ version: 1, name, value: 1 }),
      },
    });
    return `**${name}** : 1.`;
  };
}
