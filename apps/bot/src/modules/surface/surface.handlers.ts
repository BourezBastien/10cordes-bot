import { Ctx } from '@spraxium/common';
import {
  ButtonParams,
  DynamicButtonHandler,
  ModalComponent,
  ModalHandler,
  ModalInput,
  StringSelect,
  StringSelectHandler,
} from '@spraxium/components';
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { SurfaceService } from './surface.service';
import { SurfaceActionButton } from './surface.renderer';
import { PrismaService } from '../database/prisma.service';
import { runToolAsActor } from '../../shared/actions/run-tool';

/**
 * LE trio de handlers génériques du moteur (les seuls handlers de composants
 * du bot à terme — la Phase 3 retire les handlers métier) :
 * - SurfaceActHandler    : boutons (customId `surface:act~b=<key>` inline)
 * - SurfaceSelectHandler : menus (customId `surface:select~s=<row>`, les 5
 *                          types couverts — le routing est identique)
 * - SurfaceModalHandler  : modals (id `surface:modal~s=<surface>~b=<key>`)
 *
 * Garde API v10 : openModal est inspecté AVANT tout deferReply (règle des
 * 3 s — showModal doit être la PREMIÈRE réponse de l'interaction).
 * Prisma passe par le PrismaService injecté (jamais de client ad hoc).
 */

interface ActorAdapterArgs {
  guildId: string | null;
  channelId: string | null;
  userId: string;
  permissions: string[];
  roleIds: string[];
}

function runToolFor(actor: ActorAdapterArgs) {
  return (name: string, input: unknown) =>
    runToolAsActor(name, input, actor).then((r) => ({ ok: r.ok, summary: r.summary }));
}

/** Composant select générique : le suffixe ~s=<row> est porté par le customId
 * réel ; Spraxium route par baseId exact, la rangée se lit au dispatch. */
@StringSelect({ customId: 'surface:select' })
export class SurfaceSelectComponent {}

@DynamicButtonHandler(SurfaceActionButton)
export class SurfaceActHandler {
  constructor(
    private readonly surfaces: SurfaceService,
    private readonly prisma: PrismaService,
  ) {}

  async handle(@Ctx() interaction: ButtonInteraction, @ButtonParams() params: { b: string }): Promise<void> {
    const messageId = interaction.message?.id;
    if (!messageId || !params.b) return;
    const row = await this.prisma.interactiveSurface.findFirst({ where: { messageId }, select: { id: true } });
    if (!row) return;
    const surface = await this.surfaces.loadSurface(row.id);
    if (!surface) return;
    const binding = await this.surfaces.findBindingFor(surface.definition, params.b);
    if (!binding) return;

    // RÈGLE DES 3 s : si la 1re étape est openModal, showModal DOIT être la
    // première réponse — AUCUN deferReply avant ce point.
    const first = binding.pipeline[0];
    if (first?.type === 'openModal') {
      const builder = new ModalBuilder()
        .setCustomId(`surface:modal~s=${row.id}~b=${params.b}`)
        .setTitle(first.modal.title.slice(0, 45));
      for (const field of first.modal.inputs) {
        const input = new TextInputBuilder()
          .setCustomId(field.id)
          .setLabel(field.label.slice(0, 45))
          .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(field.required);
        if (field.placeholder) input.setPlaceholder(field.placeholder.slice(0, 100));
        if (field.minLength !== undefined) input.setMinLength(field.minLength);
        if (field.maxLength !== undefined) input.setMaxLength(field.maxLength);
        builder.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
      }
      await interaction.showModal(builder).catch(() => {});
      return;
    }

    await interaction.deferReply({ flags: 64 }).catch(() => {});
    const member = interaction.guild?.members.cache.get(interaction.user.id) ?? null;
    await this.surfaces.runInteraction({
      surfaceId: row.id,
      bindingKey: params.b,
      member,
      userId: interaction.user.id,
      replyEphemeral: async (content) => {
        await interaction.editReply({ content }).catch(() => {});
      },
      showModal: async () => {},
      runToolAsActor: runToolFor({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        permissions: (member?.permissions.toArray() as string[]) ?? [],
        roleIds: member?.roles.cache.map((role) => role.id) ?? [],
      }),
    });
    await interaction.deleteReply().catch(() => {});
  }
}

@StringSelectHandler(SurfaceSelectComponent)
export class SurfaceSelectHandler {
  constructor(
    private readonly surfaces: SurfaceService,
    private readonly prisma: PrismaService,
  ) {}

  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    if (!interaction.isAnySelectMenu()) return;
    const messageId = interaction.message?.id;
    const values = interaction.values ?? [];
    if (!messageId || values.length === 0) return;
    const row = await this.prisma.interactiveSurface.findFirst({ where: { messageId }, select: { id: true } });
    if (!row) return;
    await interaction.deferReply({ flags: 64 }).catch(() => {});
    const member = interaction.guild?.members.cache.get(interaction.user.id) ?? null;
    // Multi-sélection : le pipeline de CHAQUE option sélectionnée s'exécute.
    for (const key of values) {
      await this.surfaces.runInteraction({
        surfaceId: row.id,
        bindingKey: key,
        member,
        userId: interaction.user.id,
        selectedValues: values,
        replyEphemeral: async (content) => {
          await interaction.editReply({ content }).catch(() => {});
        },
        showModal: async () => {},
        runToolAsActor: runToolFor({
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user.id,
          permissions: (member?.permissions.toArray() as string[]) ?? [],
          roleIds: member?.roles.cache.map((role) => role.id) ?? [],
        }),
      });
    }
    await interaction.deleteReply().catch(() => {});
  }
}

@ModalComponent({ id: 'surface:modal', title: 'Formulaire' })
export class SurfaceModalComponent {
  @ModalInput({ label: 'f1', required: false })
  f1!: string;
  @ModalInput({ label: 'f2', required: false })
  f2!: string;
  @ModalInput({ label: 'f3', required: false })
  f3!: string;
  @ModalInput({ label: 'f4', required: false })
  f4!: string;
  @ModalInput({ label: 'f5', required: false })
  f5!: string;
}

@ModalHandler(SurfaceModalComponent)
export class SurfaceModalHandler {
  constructor(private readonly surfaces: SurfaceService) {}

  async handle(@Ctx() interaction: ModalSubmitInteraction): Promise<void> {
    // customId : surface:modal~s=<surfaceId>~b=<bindingKey>
    const surfaceId = interaction.customId.match(/~s=([A-Za-z0-9_-]+)/u)?.[1];
    const bindingKey = interaction.customId.match(/~b=([a-z0-9-]+)/u)?.[1];
    if (!surfaceId || !bindingKey) return;
    // Les champs sont relus DEPUIS la spec du binding (ids connus du moteur).
    const inputs: Record<string, string> = {};
    const surface = await this.surfaces.loadSurface(surfaceId);
    const binding = surface ? await this.surfaces.findBindingFor(surface.definition, bindingKey) : null;
    const first = binding?.pipeline[0];
    if (first?.type === 'openModal') {
      for (const field of first.modal.inputs) {
        inputs[field.id] = interaction.fields.getTextInputValue(field.id).slice(0, 4000);
      }
    }
    await interaction.deferReply({ flags: 64 }).catch(() => {});
    const member = interaction.guild?.members.cache.get(interaction.user.id) ?? null;
    await this.surfaces.runInteraction({
      surfaceId,
      bindingKey,
      member,
      userId: interaction.user.id,
      inputs,
      replyEphemeral: async (content) => {
        await interaction.editReply({ content }).catch(() => {});
      },
      showModal: async () => {},
      runToolAsActor: runToolFor({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        permissions: (member?.permissions.toArray() as string[]) ?? [],
        roleIds: member?.roles.cache.map((role) => role.id) ?? [],
      }),
    });
    await interaction.deleteReply().catch(() => {});
  }
}
