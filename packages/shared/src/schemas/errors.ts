/** Codes d'erreur métier — clés des messages personnalisables par serveur (`errorMessages`). */
export const ERROR_CODES = {
  MODULE_DISABLED: 'MODULE_DISABLED',
  MODULE_DEPENDENCY: 'MODULE_DEPENDENCY',
  MODULE_CHANNEL: 'MODULE_CHANNEL',
  UNKNOWN_MODULE: 'UNKNOWN_MODULE',
  CONFIG_VALIDATION: 'CONFIG_VALIDATION',
  COOLDOWN: 'COOLDOWN',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
