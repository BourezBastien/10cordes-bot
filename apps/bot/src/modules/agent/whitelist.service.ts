import { Injectable } from '@spraxium/common';
import { PrismaService } from '../database/prisma.service';

/**
 * Whitelist d'IDs Discord autorisés à valider les ops destructives de l'Agent Admin
 * (ban/kick/suppressions). Le owner du serveur est toujours autorisé implicitement.
 */
@Injectable()
export class AdminWhitelistService {
  constructor(private readonly prisma: PrismaService) {}

  async isWhitelisted(guildId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.adminWhitelist.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    return row !== null;
  }

  async add(guildId: string, userId: string, addedBy: string): Promise<void> {
    await this.prisma.adminWhitelist.upsert({
      where: { guildId_userId: { guildId, userId } },
      update: {},
      create: { guildId, userId, addedBy },
    });
  }

  async remove(guildId: string, userId: string): Promise<boolean> {
    const deleted = await this.prisma.adminWhitelist.deleteMany({
      where: { guildId, userId },
    });
    return deleted.count > 0;
  }

  async list(guildId: string): Promise<string[]> {
    const rows = await this.prisma.adminWhitelist.findMany({
      where: { guildId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.userId);
  }
}
