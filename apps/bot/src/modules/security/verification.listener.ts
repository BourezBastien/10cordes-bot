import { Listener, On } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  Events,
  MessageFlags,
  TextDisplayBuilder,
  type GuildMember,
} from 'discord.js';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { VerificationService } from './verification.service';

/**
 * Gate à l'arrivée : message de vérification dans le salon configuré (ou le
 * salon système) + kick planifié si non vérifié dans les délais.
 */
@Listener(Events.GuildMemberAdd)
export class VerificationJoinListener {
  private readonly log = new Logger('Security');

  constructor(
    private readonly config: GuildConfigService,
    private readonly verification: VerificationService,
  ) {}

  @On()
  async onMemberAdd(member: GuildMember): Promise<void> {
    if (member.user.bot) return;
    const config = await this.config.get(member.guild.id).catch(() => null);
    if (!config?.security.verificationEnabled) return;
    const targetChannelId = config.security.verificationChannelId ?? member.guild.systemChannelId;
    if (!targetChannelId) return;
    const channel = member.guild.channels.cache.get(targetChannelId);
    if (!channel?.isTextBased()) return;

    const minutes = config.security.kickMinutes;
    const container = new ContainerBuilder().setAccentColor(0xd9_59_26);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🔐 Bienvenue <@${member.id}>`));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `Clique **Je ne suis pas un robot** puis résous le petit calcul pour débloquer ton accès.` +
          (minutes > 0 ? `\n\n⏱️ Sans vérification : expulsion automatique dans **${minutes} min**.` : ''),
      ),
    );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('verify:gate').setLabel('Je ne suis pas un robot').setStyle(ButtonStyle.Primary),
    );
    await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container, row] }).catch(() => {});
    if (minutes > 0) await this.verification.scheduleKick(member, minutes);
    void this.log;
  }
}
