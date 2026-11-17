import { Ctx } from '@spraxium/common';
import { StringSelect, StringSelectHandler } from '@spraxium/components';
import { MessageFlags, type GuildMember, type StringSelectMenuInteraction } from 'discord.js';
import { panel } from '../../shared/ui';

export const RR_SELECT_ID = 'rr:select';

@StringSelect({ customId: RR_SELECT_ID, placeholder: 'Choisis tes rôles' })
export class RRSelect {}

/** Toggle des rôles pour le membre qui utilise le menu (add si absent, remove si présent). */
@StringSelectHandler(RRSelect)
export class RRSelectHandler {
  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    const guild = interaction.guild;
    const member = interaction.member as GuildMember | null;
    if (!guild || !member) return;

    const toggled: string[] = [];
    const failed: string[] = [];
    for (const roleId of interaction.values) {
      const role = guild.roles.cache.get(roleId);
      if (!role || !role.editable) {
        failed.push(roleId);
        continue;
      }
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId).catch(() => failed.push(roleId));
        if (!failed.includes(roleId)) toggled.push(`➖ **${role.name}** retiré`);
      } else {
        await member.roles.add(roleId).catch(() => failed.push(roleId));
        if (!failed.includes(roleId)) toggled.push(`➕ **${role.name}** ajouté`);
      }
    }

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## 🎭 Rôles mis à jour',
          lines: [...toggled, ...(failed.length > 0 ? [`❌ Échec sur : ${failed.map((id) => `<@&${id}>`).join(' ')}`] : [])],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}
