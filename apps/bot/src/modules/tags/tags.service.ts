import { Injectable } from '@spraxium/common';
import { PrismaService } from '../database/prisma.service';

export interface TagView {
  name: string;
  content: string;
  uses: number;
}

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

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
