import { aiEn } from './ai.en';
import { commonEn } from './common.en';
import { guildEn } from './guild.en';
import type { fr } from './fr';

/** Ressources anglaises : la forme exacte du français, sous peine de compilation. */
export const en: typeof fr = { ...commonEn, ...aiEn, ...guildEn };
