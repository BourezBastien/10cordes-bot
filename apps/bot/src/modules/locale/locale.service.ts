import { Injectable } from '@spraxium/common';
import { SupportedLocale, type SupportedLocaleValue } from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';

interface LocaleEntry {
  locale: string;
  source: 'manual' | 'auto';
}

/**
 * Langue PAR UTILISATEUR (jamais par serveur).
 * Résolution : préférence manuelle (`/language set`) > langue du client Discord
 * capturée automatiquement à la première interaction > fallback serveur.
 */
@Injectable()
export class LocaleService {
  private readonly cache = new Map<string, LocaleEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /** langue supportée la plus proche : fr-FR → fr, en-GB → en ; sinon undefined. */
  normalize(locale: string): SupportedLocaleValue | undefined {
    const base = locale.toLowerCase().split('-')[0] ?? '';
    const parsed = SupportedLocale.safeParse(base);
    return parsed.success ? parsed.data : undefined;
  }

  /** Capture automatique de la langue du client Discord, une seule fois par utilisateur. */
  async detect(userId: string, clientLocale: string): Promise<void> {
    if (this.cache.has(userId)) return;
    const row = await this.prisma.userLocale.findUnique({ where: { userId } });
    if (row) {
      this.cache.set(userId, { locale: row.locale, source: row.source === 'manual' ? 'manual' : 'auto' });
      return;
    }
    const detected = this.normalize(clientLocale) ?? 'fr';
    await this.prisma.userLocale.upsert({
      where: { userId },
      update: {},
      create: { userId, locale: detected, source: 'auto' },
    });
    this.cache.set(userId, { locale: detected, source: 'auto' });
  }

  async set(userId: string, locale: SupportedLocaleValue): Promise<void> {
    await this.prisma.userLocale.upsert({
      where: { userId },
      update: { locale, source: 'manual' },
      create: { userId, locale, source: 'manual' },
    });
    this.cache.set(userId, { locale, source: 'manual' });
  }

  async reset(userId: string): Promise<void> {
    await this.prisma.userLocale.deleteMany({ where: { userId } });
    this.cache.delete(userId);
  }

  async resolve(userId: string, fallback: SupportedLocaleValue = 'fr'): Promise<SupportedLocaleValue> {
    const entry = this.cache.get(userId) ?? (await this.load(userId));
    return this.normalize(entry?.locale ?? '') ?? fallback;
  }

  async getSource(userId: string): Promise<'manual' | 'auto' | 'unset'> {
    const entry = this.cache.get(userId) ?? (await this.load(userId));
    return entry?.source ?? 'unset';
  }

  private async load(userId: string): Promise<LocaleEntry | undefined> {
    const row = await this.prisma.userLocale.findUnique({ where: { userId } });
    if (!row) return undefined;
    const entry: LocaleEntry = { locale: row.locale, source: row.source === 'manual' ? 'manual' : 'auto' };
    this.cache.set(userId, entry);
    return entry;
  }
}
