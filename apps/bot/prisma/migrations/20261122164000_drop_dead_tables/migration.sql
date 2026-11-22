-- Drop dead tables identified by the 22/11 audit (zero code usage):
-- Tag (feature never shipped), AdminWhitelist (plans flow removed 17/11),
-- AgentPlan (direct execution since 17/11), UserLocale (never read).
DROP TABLE IF EXISTS "tags";
DROP TABLE IF EXISTS "admin_whitelist";
DROP TABLE IF EXISTS "agent_plans";
DROP TABLE IF EXISTS "user_locales";
