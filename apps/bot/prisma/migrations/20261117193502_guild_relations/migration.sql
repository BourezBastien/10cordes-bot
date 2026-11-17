-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_admin_whitelist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_whitelist_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_admin_whitelist" ("addedBy", "createdAt", "guildId", "id", "userId") SELECT "addedBy", "createdAt", "guildId", "id", "userId" FROM "admin_whitelist";
DROP TABLE "admin_whitelist";
ALTER TABLE "new_admin_whitelist" RENAME TO "admin_whitelist";
CREATE UNIQUE INDEX "admin_whitelist_guildId_userId_key" ON "admin_whitelist"("guildId", "userId");
CREATE TABLE "new_agent_automations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerFilter" TEXT NOT NULL DEFAULT '{}',
    "actions" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_automations_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_agent_automations" ("actions", "createdAt", "createdByUserId", "enabled", "guildId", "id", "name", "triggerFilter", "triggerType") SELECT "actions", "createdAt", "createdByUserId", "enabled", "guildId", "id", "name", "triggerFilter", "triggerType" FROM "agent_automations";
DROP TABLE "agent_automations";
ALTER TABLE "new_agent_automations" RENAME TO "agent_automations";
CREATE INDEX "agent_automations_guildId_enabled_idx" ON "agent_automations"("guildId", "enabled");
CREATE TABLE "new_agent_panels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "definition" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_panels_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_agent_panels" ("channelId", "createdAt", "createdByUserId", "definition", "guildId", "id", "kind", "messageId") SELECT "channelId", "createdAt", "createdByUserId", "definition", "guildId", "id", "kind", "messageId" FROM "agent_panels";
DROP TABLE "agent_panels";
ALTER TABLE "new_agent_panels" RENAME TO "agent_panels";
CREATE INDEX "agent_panels_guildId_messageId_idx" ON "agent_panels"("guildId", "messageId");
CREATE TABLE "new_agent_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ops" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "results" TEXT,
    "approvedBy" TEXT,
    "panelMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "agent_plans_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_agent_plans" ("approvedBy", "channelId", "createdAt", "expiresAt", "guildId", "id", "ops", "panelMessageId", "requesterId", "results", "status", "title") SELECT "approvedBy", "channelId", "createdAt", "expiresAt", "guildId", "id", "ops", "panelMessageId", "requesterId", "results", "status", "title" FROM "agent_plans";
DROP TABLE "agent_plans";
ALTER TABLE "new_agent_plans" RENAME TO "agent_plans";
CREATE INDEX "agent_plans_guildId_status_idx" ON "agent_plans"("guildId", "status");
CREATE TABLE "new_agent_skills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "agent_skills_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_agent_skills" ("createdAt", "createdByUserId", "deletedAt", "guildId", "id", "rule", "trigger", "usageCount") SELECT "createdAt", "createdByUserId", "deletedAt", "guildId", "id", "rule", "trigger", "usageCount" FROM "agent_skills";
DROP TABLE "agent_skills";
ALTER TABLE "new_agent_skills" RENAME TO "agent_skills";
CREATE INDEX "agent_skills_guildId_deletedAt_idx" ON "agent_skills"("guildId", "deletedAt");
CREATE TABLE "new_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'system',
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "targetId" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_audit_logs" ("action", "actorId", "createdAt", "guildId", "id", "metadata", "source", "targetId") SELECT "action", "actorId", "createdAt", "guildId", "id", "metadata", "source", "targetId" FROM "audit_logs";
DROP TABLE "audit_logs";
ALTER TABLE "new_audit_logs" RENAME TO "audit_logs";
CREATE INDEX "audit_logs_guildId_createdAt_idx" ON "audit_logs"("guildId", "createdAt");
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
CREATE TABLE "new_guild_memories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "guild_memories_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_guild_memories" ("content", "createdAt", "guildId", "id", "kind") SELECT "content", "createdAt", "guildId", "id", "kind" FROM "guild_memories";
DROP TABLE "guild_memories";
ALTER TABLE "new_guild_memories" RENAME TO "guild_memories";
CREATE INDEX "guild_memories_guildId_idx" ON "guild_memories"("guildId");
CREATE TABLE "new_guild_memory_profiles" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "guild_memory_profiles_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_guild_memory_profiles" ("guildId", "text", "updatedAt") SELECT "guildId", "text", "updatedAt" FROM "guild_memory_profiles";
DROP TABLE "guild_memory_profiles";
ALTER TABLE "new_guild_memory_profiles" RENAME TO "guild_memory_profiles";
CREATE TABLE "new_member_memories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_memories_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_member_memories" ("content", "createdAt", "guildId", "id", "kind", "userId") SELECT "content", "createdAt", "guildId", "id", "kind", "userId" FROM "member_memories";
DROP TABLE "member_memories";
ALTER TABLE "new_member_memories" RENAME TO "member_memories";
CREATE INDEX "member_memories_guildId_userId_idx" ON "member_memories"("guildId", "userId");
CREATE TABLE "new_member_memory_profiles" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("guildId", "userId"),
    CONSTRAINT "member_memory_profiles_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_member_memory_profiles" ("guildId", "text", "updatedAt", "userId") SELECT "guildId", "text", "updatedAt", "userId" FROM "member_memory_profiles";
DROP TABLE "member_memory_profiles";
ALTER TABLE "new_member_memory_profiles" RENAME TO "member_memory_profiles";
CREATE TABLE "new_mod_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "caseId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mod_cases_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_mod_cases" ("action", "caseId", "createdAt", "durationMs", "guildId", "id", "moderatorId", "reason", "userId") SELECT "action", "caseId", "createdAt", "durationMs", "guildId", "id", "moderatorId", "reason", "userId" FROM "mod_cases";
DROP TABLE "mod_cases";
ALTER TABLE "new_mod_cases" RENAME TO "mod_cases";
CREATE INDEX "mod_cases_guildId_userId_idx" ON "mod_cases"("guildId", "userId");
CREATE UNIQUE INDEX "mod_cases_guildId_caseId_key" ON "mod_cases"("guildId", "caseId");
CREATE TABLE "new_mod_counters" (
    "value" INTEGER NOT NULL DEFAULT 0,
    "guildId" TEXT NOT NULL PRIMARY KEY,
    CONSTRAINT "mod_counters_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_mod_counters" ("guildId", "value") SELECT "guildId", "value" FROM "mod_counters";
DROP TABLE "mod_counters";
ALTER TABLE "new_mod_counters" RENAME TO "mod_counters";
CREATE TABLE "new_role_backups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleIds" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "role_backups_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_role_backups" ("createdAt", "createdBy", "guildId", "id", "roleIds", "userId") SELECT "createdAt", "createdBy", "guildId", "id", "roleIds", "userId" FROM "role_backups";
DROP TABLE "role_backups";
ALTER TABLE "new_role_backups" RENAME TO "role_backups";
CREATE INDEX "role_backups_guildId_userId_idx" ON "role_backups"("guildId", "userId");
CREATE TABLE "new_tags" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tags_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_tags" ("content", "createdAt", "createdBy", "guildId", "id", "name", "updatedAt", "uses") SELECT "content", "createdAt", "createdBy", "guildId", "id", "name", "updatedAt", "uses" FROM "tags";
DROP TABLE "tags";
ALTER TABLE "new_tags" RENAME TO "tags";
CREATE UNIQUE INDEX "tags_guildId_name_key" ON "tags"("guildId", "name");
CREATE TABLE "new_ticket_counters" (
    "value" INTEGER NOT NULL DEFAULT 0,
    "guildId" TEXT NOT NULL PRIMARY KEY,
    CONSTRAINT "ticket_counters_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ticket_counters" ("guildId", "value") SELECT "guildId", "value" FROM "ticket_counters";
DROP TABLE "ticket_counters";
ALTER TABLE "new_ticket_counters" RENAME TO "ticket_counters";
CREATE TABLE "new_tickets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "claimedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "tickets_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_tickets" ("channelId", "claimedBy", "closedAt", "createdAt", "guildId", "id", "number", "status", "userId") SELECT "channelId", "claimedBy", "closedAt", "createdAt", "guildId", "id", "number", "status", "userId" FROM "tickets";
DROP TABLE "tickets";
ALTER TABLE "new_tickets" RENAME TO "tickets";
CREATE INDEX "tickets_guildId_userId_idx" ON "tickets"("guildId", "userId");
CREATE UNIQUE INDEX "tickets_guildId_channelId_key" ON "tickets"("guildId", "channelId");
CREATE TABLE "new_user_levels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_levels_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_user_levels" ("guildId", "id", "level", "updatedAt", "userId", "xp") SELECT "guildId", "id", "level", "updatedAt", "userId", "xp" FROM "user_levels";
DROP TABLE "user_levels";
ALTER TABLE "new_user_levels" RENAME TO "user_levels";
CREATE INDEX "user_levels_guildId_xp_idx" ON "user_levels"("guildId", "xp");
CREATE UNIQUE INDEX "user_levels_guildId_userId_key" ON "user_levels"("guildId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
