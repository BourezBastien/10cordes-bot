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
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { Logger } from '@spraxium/logger';
import type { ModalSpec } from '@10cordes/shared';
import { SurfaceService } from './surface.service';
import { SurfaceActionButton } from './surface.renderer';
import { InteractionReply } from './surface-reply';
import { SurfaceNoticePresenter } from './presenters/surface-notice.presenter';
import { PrismaService } from '../database/prisma.service';
import { permissionsOf } from '../../core/security/permission-name';
import { runToolAsActor } from '../../shared/actions/run-tool';
import { fileLog } from '../logging/file-log.service';
import { assertModalFits } from '../../shared/ui/modal-limits';

const log = new Logger('SurfaceHandlers');

/**
 * LE trio de handlers génériques du moteur (les seuls handlers de composants
 * du bot) :
 * - SurfaceActHandler    : boutons (customId `surface:act~b=<key>` inline)
 * - SurfaceSelectHandler : menus (customId `surface:select~s=<row>`, les 5
 *                          types couverts, le routing est identique)
 * - SurfaceModalHandler  : modals (id `surface:modal~s=<surface>~b=<key>`)
 *
 * Deux garanties, nées d'incidents réels :
 * - AUCUN clic n'est silencieux : surface ou binding disparu, pipeline
 *   refusé, réussi ou en erreur, le membre voit toujours un message éphémère ;
 * - Garde API v10 : openModal est inspecté AVANT tout deferReply (règle des
 *   3 s, showModal doit être la PREMIÈRE réponse de l'interaction).
 * Prisma passe par le PrismaService injecté (jamais de client ad hoc).
 */

/** Ce qu'un handler lit d'une interaction de surface (structurel). */
interface SurfaceInteraction {
  id: string;
  user: { id: string };
  guild: Guild | null;
  guildId: string | null;
  channelId: string | null;
}

/** Lance un tool du registry avec les permissions RÉELLES du membre qui a cliqué. */
function runToolFor(interaction: SurfaceInteraction, member: GuildMember | null) {
  return (name: string, input: unknown) =>
    runToolAsActor(name, input, {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      permissions: permissionsOf(member),
      roleIds: member?.roles.cache.map((role) => role.id) ?? [],
    }).then((r) => ({ ok: r.ok, summary: r.summary }));
}

/** Cherche la surface affichée par un message et le binding activé ; null si l'un des deux a disparu. */
async function resolveBinding(prisma: PrismaService, surfaces: SurfaceService, messageId: string | undefined, key: string) {
  if (!messageId) return null;
  const row = await prisma.interactiveSurface.findFirst({ where: { messageId }, select: { id: true } });
  if (!row) return null;
  const surface = await surfaces.loadSurface(row.id);
  if (!surface) return null;
  const binding = await surfaces.findBindingFor(surface.definition, key);
  return binding ? { row, binding } : null;
}

/** Exécute le pipeline, puis s'assure qu'un message éphémère reste visible. */
async function executeAndAnswer(
  surfaces: SurfaceService,
  presenter: SurfaceNoticePresenter,
  reply: InteractionReply,
  interaction: SurfaceInteraction,
  args: { surfaceId: string; bindingKey: string; selectedValues?: string[]; inputs?: Record<string, string> },
): Promise<void> {
  const member = interaction.guild?.members.cache.get(interaction.user.id) ?? null;
  const result = await surfaces.runInteraction({
    ...args,
    member,
    userId: interaction.user.id,
    replyEphemeral: async (content) => reply.show(presenter.pipeline(content)),
    showModal: async () => {},
    runToolAsActor: runToolFor(interaction, member),
  });
  if (!reply.isAnswered) await reply.show(result.ok ? presenter.done() : presenter.failed(result.message));
}

/** Un échec du handler reste diagnostiquable et reçoit toujours une réponse. */
async function reportFailure(reply: InteractionReply, presenter: SurfaceNoticePresenter, step: string, interactionId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  log.warn(`surface ${step} impossible (${message.slice(0, 140)})`);
  fileLog()?.event('warn', 'surface', 'interaction_failed', { step, interactionId, error: message.slice(0, 300) });
  await reply.show(presenter.crashed(interactionId)).catch(() => {});
}

/** Modale d'un binding (customId `surface:modal~s=<surface>~b=<key>`), champs relus depuis la spec. */
function buildSurfaceModal(surfaceId: string, bindingKey: string, spec: ModalSpec): ModalBuilder {
  const builder = new ModalBuilder().setCustomId(`surface:modal~s=${surfaceId}~b=${bindingKey}`).setTitle(spec.title.slice(0, 45));
  for (const field of spec.inputs) {
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
  // Le schéma borne déjà les entrées à cinq : la garde en fixe la preuve.
  assertModalFits(builder.toJSON(), 'Modale de surface');
  return builder;
}

/** Composant select générique : le suffixe ~s=<row> est porté par le customId
 * réel ; Spraxium route par baseId exact, la rangée se lit au dispatch. */
@StringSelect({ customId: 'surface:select' })
export class SurfaceSelectComponent {}

@DynamicButtonHandler(SurfaceActionButton)
export class SurfaceActHandler {
  // Presenter pur : champ de classe, jamais un paramètre de constructeur DI.
  private readonly presenter = new SurfaceNoticePresenter();

  constructor(
    private readonly surfaces: SurfaceService,
    private readonly prisma: PrismaService,
  ) {}

  async handle(@Ctx() interaction: ButtonInteraction, @ButtonParams() params: { b: string }): Promise<void> {
    const reply = new InteractionReply(interaction, this.presenter);
    try {
      const found = await resolveBinding(this.prisma, this.surfaces, interaction.message?.id, params.b);
      if (!found) {
        await reply.show(this.presenter.inactive());
        return;
      }
      const first = found.binding.pipeline[0];
      if (first?.type === 'openModal') {
        await interaction.showModal(buildSurfaceModal(found.row.id, params.b, first.modal)).catch(() => {});
        return;
      }
      await reply.defer();
      await executeAndAnswer(this.surfaces, this.presenter, reply, interaction, { surfaceId: found.row.id, bindingKey: params.b });
    } catch (error) {
      await reportFailure(reply, this.presenter, 'act', interaction.id, error);
    }
  }
}

@StringSelectHandler(SurfaceSelectComponent)
export class SurfaceSelectHandler {
  private readonly presenter = new SurfaceNoticePresenter();

  constructor(
    private readonly surfaces: SurfaceService,
    private readonly prisma: PrismaService,
  ) {}

  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    if (!interaction.isAnySelectMenu()) return;
    const reply = new InteractionReply(interaction, this.presenter);
    const values = interaction.values ?? [];
    try {
      const found = await resolveBinding(this.prisma, this.surfaces, interaction.message?.id, values[0] ?? '');
      if (!found) {
        await reply.show(this.presenter.inactive());
        return;
      }
      await reply.defer();
      // Multi-sélection : le pipeline de CHAQUE option sélectionnée s'exécute.
      for (const key of values) {
        await executeAndAnswer(this.surfaces, this.presenter, reply, interaction, { surfaceId: found.row.id, bindingKey: key, selectedValues: values });
      }
    } catch (error) {
      await reportFailure(reply, this.presenter, 'select', interaction.id, error);
    }
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
  private readonly presenter = new SurfaceNoticePresenter();

  constructor(private readonly surfaces: SurfaceService) {}

  async handle(@Ctx() interaction: ModalSubmitInteraction): Promise<void> {
    const reply = new InteractionReply(interaction, this.presenter);
    // customId : surface:modal~s=<surfaceId>~b=<bindingKey>
    const surfaceId = interaction.customId.match(/~s=([A-Za-z0-9_-]+)/u)?.[1];
    const bindingKey = interaction.customId.match(/~b=([a-z0-9-]+)/u)?.[1];
    try {
      const surface = surfaceId ? await this.surfaces.loadSurface(surfaceId) : null;
      const binding = surface && bindingKey ? await this.surfaces.findBindingFor(surface.definition, bindingKey) : null;
      const first = binding?.pipeline[0];
      if (!surfaceId || !bindingKey || !surface || first?.type !== 'openModal') {
        await reply.show(this.presenter.inactive());
        return;
      }
      // Les champs sont relus DEPUIS la spec du binding (ids connus du moteur).
      const inputs: Record<string, string> = {};
      for (const field of first.modal.inputs) {
        inputs[field.id] = interaction.fields.getTextInputValue(field.id).slice(0, 4000);
      }
      await reply.defer();
      await executeAndAnswer(this.surfaces, this.presenter, reply, interaction, { surfaceId, bindingKey, inputs });
    } catch (error) {
      await reportFailure(reply, this.presenter, 'modal', interaction.id, error);
    }
  }
}
