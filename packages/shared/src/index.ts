export * from './types/module-descriptor.js';
export * from './schemas/module-constraints.js';
export * from './schemas/guild-config.js';
export * from './schemas/components.js';
export * from './schemas/errors.js';
export * from './module-dependencies.js';
export * from './template-engine.js';
export * from './tools/types.js';
// Re-export explicite (le `export *` chaîné perd AgentPlanSchema sous TS7/bundler).
export {
  AdminOpSchema,
  type AdminOp,
  AgentPlanSchema,
  type AgentPlanInput,
  DESTRUCTIVE_OP_TYPES,
  opLabel,
} from './tools/admin-ops.js';
