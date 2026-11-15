import { Listener } from '@spraxium/common';
import { Events, MessageFlags, type Message } from 'discord.js';
import { xpForLevel } from '../levels.service';
import { GuildConfigService } from '../../guild-config/guild-config.service';
import { LevelsService } from '../levels.service';
import { panel } from '../../../shared/ui';

/**
 * XP par message : skip bots, config-gated, cooldown par utilisateur.
 * Au level-up : annonce (salon dédié ou canal courant) + attribution des
 * rôles-récompenses atteints (13✅).
 */
@Listener(Events.MessageCreate)
export class MessageXpListener {
  constructor(
    private readonly config: GuildConfigService,
    private readonly levels: LevelsService,
  ) {}

  async onMessageCreate(message: Message): Promise<void> {
    if (message.author.bot || !message.guild) return;
    const guildId = message.guild.id;
    const config = await this.config.get(guildId);
    if (!config.levels.enabled) return;

    const cooldownMs = config.levels.cooldownMinutes * 60 * 1_000;
    if (this.levels.isOnCooldown(guildId, message.author.id, cooldownMs)) return;
    this.levels.markActivity(guildId, message.author.id);

    const result = await this.levels.grantXp(guildId, message.author.id, config.levels.xpPerMessage);
    if (!result.leveledUp) return;

    // Rôles-récompenses atteints au nouveau niveau.
    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (member) {
      for (const reward of config.levels.roleRewards) {
        if (result.level >= reward.level && !member.roles.cache.has(reward.roleId)) {
          await member.roles.add(reward.roleId, `level ${result.level} reward`).catch(() => {});
        }
      }
    }

    const announceChannelId = config.levels.announceChannelId ?? message.channelId;
    const announceChannel = await message.guild.channels.fetch(announceChannelId).catch(() => null);
    if (!announceChannel?.isTextBased() || announceChannel.partial) return;

    const nextLevel = result.level + 1;
    const remaining = Math.max(0, xpForLevel(nextLevel) - result.xp);
    await announceChannel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        panel({
          title: `## 🎉 Niveau ${result.level} !`,
          lines: [
            `Bravo <@${message.author.id}> — niveau **${result.level}** atteint.`,
            `Prochain niveau à **${remaining}** XP restants.`,
          ],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}
