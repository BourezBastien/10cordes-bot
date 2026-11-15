import { PrismaClient } from '@prisma/client';
import { GuildConfigSchema, SupportedLocale } from '@10cordes/shared';
import type { I18nStore } from '@spraxium/i18n';

/**
 * Store i18n persisté en Prisma.
 * - Utilisateur : table `user_locales` (partagée avec le module locale).
 * - Serveur : champ `defaultLocale` du document de configuration (guild settings).
 */
export class PrismaI18nStore implements I18nStore {
  private prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? 'file:../data/bot.db' } } });

  async init(): Promise<void> {
    await this.prisma.$connect();
  }

  async getUser(userId: string): Promise<string | undefined> {
    const row = await this.prisma.userLocale.findUnique({ where: { userId } });
    return row?.locale;
  }

  async setUser(userId: string, locale: string): Promise<void> {
    await this.prisma.userLocale.upsert({
      where: { userId },
      update: { locale, source: 'manual' },
      create: { userId, locale, source: 'manual' },
    });
  }

  async getGuild(guildId: string): Promise<string | undefined> {
    const row = await this.prisma.guild.findUnique({ where: { id: guildId } });
    if (!row) return undefined;
    const parsed = GuildConfigSchema.safeParse(JSON.parse(row.settings));
    return parsed.success ? parsed.data.defaultLocale : undefined;
  }

  async setGuild(guildId: string, locale: string): Promise<void> {
    const row = await this.prisma.guild.upsert({
      where: { id: guildId },
      update: {},
      create: { id: guildId },
    });
    const current = GuildConfigSchema.parse(JSON.parse(row.settings));
    const localeValue = SupportedLocale.parse(locale);
    const settings = GuildConfigSchema.parse({ ...current, defaultLocale: localeValue });
    await this.prisma.guild.update({
      where: { id: guildId },
      data: { settings: JSON.stringify(settings) },
    });
  }
}
