import { Ctx } from '@spraxium/common';
import { Button, ButtonHandler } from '@spraxium/components';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { PollsService, POLL_VOTE_PREFIX } from './polls.service';

/**
 * Boutons de vote des sondages : customIds statiques poll:vote:0..5
 * (6 options max), le sondage est résolu par messageId en DB. Chaque index
 * a son composant + handler déclarés explicitement (decorateur = classe
 * statique, pas de génération dynamique).
 */

@Button({ customId: `${POLL_VOTE_PREFIX}:0`, label: 'Option 1', style: 'primary' })
export class PollVote0 {}
@Button({ customId: `${POLL_VOTE_PREFIX}:1`, label: 'Option 2', style: 'primary' })
export class PollVote1 {}
@Button({ customId: `${POLL_VOTE_PREFIX}:2`, label: 'Option 3', style: 'primary' })
export class PollVote2 {}
@Button({ customId: `${POLL_VOTE_PREFIX}:3`, label: 'Option 4', style: 'primary' })
export class PollVote3 {}
@Button({ customId: `${POLL_VOTE_PREFIX}:4`, label: 'Option 5', style: 'primary' })
export class PollVote4 {}
@Button({ customId: `${POLL_VOTE_PREFIX}:5`, label: 'Option 6', style: 'primary' })
export class PollVote5 {}

abstract class PollVoteBase {
  constructor(protected readonly polls: PollsService) {}

  protected async reply(interaction: ButtonInteraction, optionIndex: number): Promise<void> {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const text = await this.polls
      .vote(interaction.message.id, optionIndex, interaction.user.id)
      .catch((error: unknown) => `Échec : ${error instanceof Error ? error.message.slice(0, 120) : 'erreur'}`);
    await interaction.editReply({ content: text }).catch(() => {});
  }
}

@ButtonHandler(PollVote0)
export class PollVote0Handler extends PollVoteBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.reply(interaction, 0);
  }
}
@ButtonHandler(PollVote1)
export class PollVote1Handler extends PollVoteBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.reply(interaction, 1);
  }
}
@ButtonHandler(PollVote2)
export class PollVote2Handler extends PollVoteBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.reply(interaction, 2);
  }
}
@ButtonHandler(PollVote3)
export class PollVote3Handler extends PollVoteBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.reply(interaction, 3);
  }
}
@ButtonHandler(PollVote4)
export class PollVote4Handler extends PollVoteBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.reply(interaction, 4);
  }
}
@ButtonHandler(PollVote5)
export class PollVote5Handler extends PollVoteBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.reply(interaction, 5);
  }
}
