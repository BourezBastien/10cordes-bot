import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { z } from 'zod';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { PrismaService } from '../database/prisma.service';

export interface TagView {
  name: string;
  content: string;
  uses: number;
}

@Injectable()
export class TagsService implements SpraxiumOnBoot {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {}

  async onBoot(): Promise<void> {
    const guildOnly = (ctx: { guildId: string | null }): ctx is { guildId: string } & typeof ctx =>
      ctx.guildId !== null;
    this.registry.register({
      name: 'getTag',
      description: "Affiche le contenu d'un tag par nom.",
      category: 'tags',
      paramsSchema: z.object({ name: z.string().min(1) }),
      requiredModules: ['tags'],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only. Rends le contenu du tag tel quel.',
      handler: async (input, ctx) => {
        if (!guildOnly(ctx)) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { name } = input as { name: string };
        const tag = await this.show(ctx.guildId, name);
        return tag
          ? { ok: true, summary: `**${tag.name}** (utilisé ${tag.uses}x) : ${tag.content}` }
          : { ok: false, summary: `Tag « ${name} » introuvable. Utilise tags.list pour voir les tags existants.` };
      },
    });
    this.registry.register({
      name: 'getTags',
      description: "Liste les tags du serveur avec leur nombre d'utilisations.",
      category: 'tags',
      paramsSchema: z.object({}).loose(),
      requiredModules: ['tags'],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (_input, ctx) => {
        if (!guildOnly(ctx)) return { ok: false, summary: 'Contexte de serveur requis.' };
        const tags = await this.list(ctx.guildId);
        if (tags.length === 0) return { ok: true, summary: 'Aucun tag sur ce serveur (tags.add pour en créer).' };
        return { ok: true, summary: `${tags.length} tag(s) : ${tags.map((tag) => `\`${tag.name}\``).join(' ')}` };
      },
    });
    this.registry.register({
      name: 'createTag',
      description: 'Crée un tag (nom + contenu).',
      category: 'tags',
      paramsSchema: z.object({
        name: z.string().min(1).max(32),
        content: z.string().min(1).max(1500),
      }),
      requiredModules: ['tags'],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Mutating mais réversible (tags.delete).',
      handler: async (input, ctx) => {
        if (!guildOnly(ctx)) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { name, content } = input as { name: string; content: string };
        await this.add(ctx.guildId, name, content, ctx.userId);
        return { ok: true, summary: `Tag « ${name} » créé.` };
      },
    });
    this.registry.register({
      name: 'deleteTag',
      description: 'Supprime un tag par nom.',
      category: 'tags',
      paramsSchema: z.object({ name: z.string().min(1) }),
      requiredModules: ['tags'],
      permissions: ['ManageGuild'],
      destructive: true,
      systemPrompt: "Destructive : confirme explicitement avec l'utilisateur avant d'appeler.",
      handler: async (input, ctx) => {
        if (!guildOnly(ctx)) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { name } = input as { name: string };
        await this.remove(ctx.guildId, name);
        return { ok: true, summary: `Tag « ${name} » supprimé.` };
      },
    });
  }

  async add(guildId: string, name: string, content: string, createdBy: string): Promise<void> {
    await this.prisma.tag.create({
      data: { guildId, name: this.normalize(name), content, createdBy },
    });
  }

  async edit(guildId: string, name: string, content: string): Promise<void> {
    const updated = await this.prisma.tag.updateMany({
      where: { guildId, name: this.normalize(name) },
      data: { content },
    });
    if (updated.count === 0) throw new Error(`Tag \`${name}\` introuvable.`);
  }

  async remove(guildId: string, name: string): Promise<void> {
    const deleted = await this.prisma.tag.deleteMany({
      where: { guildId, name: this.normalize(name) },
    });
    if (deleted.count === 0) throw new Error(`Tag \`${name}\` introuvable.`);
  }

  /** Récupère le contenu et incrémente le compteur d'utilisation. */
  async show(guildId: string, name: string): Promise<TagView | null> {
    const tag = await this.prisma.tag.findUnique({
      where: { guildId_name: { guildId, name: this.normalize(name) } },
    });
    if (!tag) return null;
    await this.prisma.tag.update({ where: { id: tag.id }, data: { uses: { increment: 1 } } });
    return { name: tag.name, content: tag.content, uses: tag.uses + 1 };
  }

  async list(guildId: string): Promise<Array<{ name: string; uses: number }>> {
    const tags = await this.prisma.tag.findMany({
      where: { guildId },
      orderBy: { uses: 'desc' },
      take: 25,
      select: { name: true, uses: true },
    });
    return tags;
  }

  private normalize(name: string): string {
    return name.trim().toLowerCase();
  }
}
