import { Injectable } from '@spraxium/common';
import { z } from 'zod';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { LocaleService } from './locale.service';

/** Tools langue personnelle — remplace l'ancienne commande /lang. */
@Injectable()
export class LocaleToolsService {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly locales: LocaleService,
  ) {}

  async onBoot(): Promise<void> {
    this.registry.register({
      name: 'getMyLanguage',
      description: 'Ta langue personnelle du bot (fr/en) et comment elle a été choisie.',
      category: 'locale',
      paramsSchema: z.object({}).loose(),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (_input, ctx) => {
        const source = await this.locales.getSource(ctx.userId).catch(() => 'unset' as const);
        const label =
          source === 'manual'
            ? 'choisie manuellement'
            : source === 'auto'
              ? 'auto-détectée de ton client Discord'
              : 'défaut du serveur';
        return { ok: true, summary: `Ta langue : ${ctx.locale} (${label}).` };
      },
    });
    this.registry.register({
      name: 'setMyLanguage',
      description: "Change ta langue personnelle du bot : 'fr' ou 'en'.",
      category: 'locale',
      paramsSchema: z.object({ locale: z.enum(['fr', 'en']) }),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Applique directement, puis confirme la nouvelle langue en une phrase.',
      handler: async (input, ctx) => {
        const { locale } = input as { locale: 'fr' | 'en' };
        await this.locales.set(ctx.userId, locale);
        return { ok: true, summary: locale === 'fr' ? 'Langue passée en français.' : 'Language switched to English.' };
      },
    });
  }
}
