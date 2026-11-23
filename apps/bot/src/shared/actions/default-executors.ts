import { PermissionFlagsBits } from 'discord.js';
import { registerComponentAction } from './registry';

/**
 * Executors par défaut des actions de composants génériques. Enregistrés au
 * boot du service qui en a la charge (panels.service). 'ticket' est enregistré
 * par panels.service (logique de création de salon) ; 'counter' par records
 * (store typé).
 */
export function registerDefaultComponentExecutors(): void {
  registerComponentAction('reply', async (action, ctx) => {
    if (action.type !== 'reply') return 'Action inattendue.';
    const channel = ctx.interaction.channel;
    if (!channel || channel.isDMBased() || !channel.isTextBased()) return 'Salon introuvable.';
    await channel.send({ content: action.message.slice(0, 1000) }).catch(() => {});
    return 'Message posté dans le salon.';
  });

  registerComponentAction('reveal', async (action, ctx) => {
    if (action.type !== 'reveal') return 'Action inattendue.';
    await ctx.interaction
      .reply({ flags: 64, content: action.message.slice(0, 1000) })
      .catch(() => {});
    return 'Contenu révélé (visible par toi seul).';
  });

  registerComponentAction('giveRole', async (action, ctx) => {
    if (action.type !== 'giveRole') return 'Action inattendue.';
    if (!ctx.member) return 'Membre introuvable.';
    const guild = ctx.member.guild;
    const me = guild.members.me;
    const role = guild.roles.cache.get(action.roleId);
    if (!role) return 'Rôle introuvable (supprimé ?).';
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return "Le bot n'a pas la permission ManageRoles.";
    if (role.position >= me.roles.highest.position) return 'Ce rôle est au-dessus du mien : impossible de le donner.';
    await ctx.member.roles.add(role, 'action de composant (panel agent)').catch(() => {});
    return `Rôle **${role.name}** ajouté.`;
  });

  registerComponentAction('removeRole', async (action, ctx) => {
    if (action.type !== 'removeRole') return 'Action inattendue.';
    if (!ctx.member) return 'Membre introuvable.';
    const guild = ctx.member.guild;
    const me = guild.members.me;
    const role = guild.roles.cache.get(action.roleId);
    if (!role) return 'Rôle introuvable (supprimé ?).';
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return "Le bot n'a pas la permission ManageRoles.";
    await ctx.member.roles.remove(role, 'action de composant (panel agent)').catch(() => {});
    return `Rôle **${role.name}** retiré.`;
  });

  registerComponentAction('link', async () => {
    // Les boutons lien sont rendus en ButtonStyle.Link : le navigateur
    // s'occupe de tout, ce handler n'est jamais appelé.
    return 'Ce bouton ouvre un lien.';
  });
}
