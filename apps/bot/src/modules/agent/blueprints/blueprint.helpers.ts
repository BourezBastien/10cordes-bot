import type { SkillBlueprint } from '@10cordes/shared';

/** Helpers de typage des params de blueprint (chaque type = un contrôle UI/adaptation LLM). */
export const str = (description: string, defaultValue: string, required = false) =>
  ({ type: 'string' as const, description, defaultValue, required });
export const num = (description: string, defaultValue: number, required = false) =>
  ({ type: 'number' as const, description, defaultValue, required });
export const bool = (description: string, defaultValue: boolean, required = false) =>
  ({ type: 'boolean' as const, description, defaultValue, required });
export const dur = (description: string, defaultValue: string, required = false) =>
  ({ type: 'duration' as const, description, defaultValue, required });
export const emoji = (description: string, defaultValue: string, required = false) =>
  ({ type: 'emoji' as const, description, defaultValue, required });
export const cron = (description: string, defaultValue: string, required = false) =>
  ({ type: 'cron' as const, description, defaultValue, required });
export const chan = (description: string, defaultValue = '', required = false) =>
  ({ type: 'channelId' as const, description, defaultValue, required });
export const role = (description: string, defaultValue = '', required = false) =>
  ({ type: 'roleId' as const, description, defaultValue, required });

export type DomainBlueprints = readonly SkillBlueprint[];
