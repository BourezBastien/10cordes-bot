-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "guilds" (
    "id" TEXT NOT NULL,
    "settings" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guilds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_module_states" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "constraints" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "guild_module_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "refreshTokenExpiresAt" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'system',
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "targetId" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mod_counters" (
    "value" INTEGER NOT NULL DEFAULT 0,
    "guildId" TEXT NOT NULL,

    CONSTRAINT "mod_counters_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "mod_cases" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "caseId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mod_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_backups" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleIds" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_skills" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_automations" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerFilter" TEXT NOT NULL DEFAULT '{}',
    "actions" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_watermarks" (
    "channelId" TEXT NOT NULL,
    "lastMessageId" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "channel_watermarks_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'tool',
    "label" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT 'custom',
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_memories" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ(3),

    CONSTRAINT "guild_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_memories" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ(3),

    CONSTRAINT "member_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_memory_profiles" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "member_memory_profiles_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateTable
CREATE TABLE "guild_memory_profiles" (
    "guildId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guild_memory_profiles_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "memory_corrections" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT,
    "oldFact" TEXT NOT NULL,
    "newFact" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ(3),

    CONSTRAINT "memory_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_cursors" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL DEFAULT '',
    "lastMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "errorMessage" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ingestion_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_agent_settings" (
    "guildId" TEXT NOT NULL,
    "thinkingMode" TEXT NOT NULL DEFAULT 'adaptive',
    "configThreadId" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guild_agent_settings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "guild_providers" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'bearer',
    "authHeaderName" TEXT,
    "encryptedApiKey" TEXT,
    "customHeadersJson" TEXT,
    "extraConfigJson" TEXT,
    "cachedModelsJson" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guild_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capability_routes" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "fallbackProviderId" TEXT,
    "fallbackModelId" TEXT,
    "paramsJson" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "capability_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_integrations" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "baseUrl" TEXT,
    "encryptedApiKey" TEXT,
    "configJson" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guild_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "url" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "authHeaderName" TEXT,
    "encryptedHeaders" TEXT,
    "publicHeadersJson" TEXT,
    "requestTemplateJson" TEXT,
    "responseExtractPath" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastHttpStatus" INTEGER,
    "lastCheckedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_usage_rows" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "requestId" TEXT,
    "cause" TEXT NOT NULL,
    "capability" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_decisions" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "channelId" TEXT,
    "intent" TEXT NOT NULL,
    "signal" TEXT,
    "motif" TEXT,
    "reasoning" BOOLEAN NOT NULL DEFAULT false,
    "effort" TEXT,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "tools" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "stepsJson" TEXT,
    "error" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_birthdays" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,

    CONSTRAINT "member_birthdays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sticky_roles" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "sticky_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "afk_statuses" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "since" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "afk_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temp_sanctions" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "revokeAt" TIMESTAMPTZ(3) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temp_sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_activities" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "voiceMinutes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "member_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_nodes" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "effect" TEXT NOT NULL,

    CONSTRAINT "tool_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "runAt" TIMESTAMPTZ(3),
    "cron" TEXT,
    "tz" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "intervalMinutes" INTEGER,
    "actions" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_records" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "channelId" TEXT,
    "messageId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_rules" (
    "guildId" TEXT NOT NULL,
    "freeCategoryIds" TEXT NOT NULL DEFAULT '[]',
    "freeChannelIds" TEXT NOT NULL DEFAULT '[]',
    "blockedChannelIds" TEXT NOT NULL DEFAULT '[]',
    "strictMentionElsewhere" BOOLEAN NOT NULL DEFAULT true,
    "seriousOnlyElsewhere" BOOLEAN NOT NULL DEFAULT false,
    "confirmDestructiveActions" BOOLEAN NOT NULL DEFAULT false,
    "customInstructions" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guild_rules_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "memory_opt_outs" (
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guildId" TEXT NOT NULL,

    CONSTRAINT "memory_opt_outs_pkey" PRIMARY KEY ("userId","guildId")
);

-- CreateTable
CREATE TABLE "interactive_surfaces" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "definition" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "interactive_surfaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_triggers" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "surfaceId" TEXT,
    "cancelKey" TEXT,
    "kind" TEXT NOT NULL,
    "runAt" TIMESTAMPTZ(3),
    "cron" TEXT,
    "intervalSec" INTEGER,
    "tz" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "condition" TEXT,
    "steps" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'armed',
    "lastRunAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_triggers" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "surfaceId" TEXT,
    "name" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "filter" TEXT NOT NULL DEFAULT '{}',
    "condition" TEXT,
    "steps" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guild_module_states_guildId_moduleId_key" ON "guild_module_states"("guildId", "moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "audit_logs_guildId_createdAt_idx" ON "audit_logs"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "mod_cases_guildId_userId_idx" ON "mod_cases"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "mod_cases_guildId_caseId_key" ON "mod_cases"("guildId", "caseId");

-- CreateIndex
CREATE INDEX "role_backups_guildId_userId_idx" ON "role_backups"("guildId", "userId");

-- CreateIndex
CREATE INDEX "agent_skills_guildId_deletedAt_idx" ON "agent_skills"("guildId", "deletedAt");

-- CreateIndex
CREATE INDEX "agent_automations_guildId_enabled_idx" ON "agent_automations"("guildId", "enabled");

-- CreateIndex
CREATE INDEX "guild_memories_guildId_idx" ON "guild_memories"("guildId");

-- CreateIndex
CREATE INDEX "member_memories_guildId_userId_idx" ON "member_memories"("guildId", "userId");

-- CreateIndex
CREATE INDEX "memory_corrections_guildId_userId_idx" ON "memory_corrections"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_cursors_guildId_channelId_key" ON "ingestion_cursors"("guildId", "channelId");

-- CreateIndex
CREATE INDEX "guild_providers_guildId_enabled_idx" ON "guild_providers"("guildId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "guild_providers_guildId_slug_key" ON "guild_providers"("guildId", "slug");

-- CreateIndex
CREATE INDEX "capability_routes_guildId_enabled_idx" ON "capability_routes"("guildId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "capability_routes_guildId_capability_key" ON "capability_routes"("guildId", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "guild_integrations_guildId_slug_key" ON "guild_integrations"("guildId", "slug");

-- CreateIndex
CREATE INDEX "webhook_endpoints_guildId_idx" ON "webhook_endpoints"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_endpoints_guildId_slug_key" ON "webhook_endpoints"("guildId", "slug");

-- CreateIndex
CREATE INDEX "llm_usage_rows_guildId_createdAt_idx" ON "llm_usage_rows"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_decisions_guildId_createdAt_idx" ON "agent_decisions"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_decisions_createdAt_idx" ON "agent_decisions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "member_birthdays_guildId_userId_key" ON "member_birthdays"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "sticky_roles_guildId_userId_roleId_key" ON "sticky_roles"("guildId", "userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "afk_statuses_guildId_userId_key" ON "afk_statuses"("guildId", "userId");

-- CreateIndex
CREATE INDEX "temp_sanctions_guildId_done_idx" ON "temp_sanctions"("guildId", "done");

-- CreateIndex
CREATE UNIQUE INDEX "member_activities_guildId_userId_key" ON "member_activities"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "tool_nodes_guildId_targetId_tool_key" ON "tool_nodes"("guildId", "targetId", "tool");

-- CreateIndex
CREATE INDEX "scheduled_jobs_guildId_enabled_idx" ON "scheduled_jobs"("guildId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_jobs_guildId_name_key" ON "scheduled_jobs"("guildId", "name");

-- CreateIndex
CREATE INDEX "agent_records_guildId_collection_createdAt_idx" ON "agent_records"("guildId", "collection", "createdAt");

-- CreateIndex
CREATE INDEX "agent_records_guildId_collection_messageId_idx" ON "agent_records"("guildId", "collection", "messageId");

-- CreateIndex
CREATE INDEX "interactive_surfaces_guildId_kind_idx" ON "interactive_surfaces"("guildId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "interactive_surfaces_guildId_messageId_key" ON "interactive_surfaces"("guildId", "messageId");

-- CreateIndex
CREATE INDEX "scheduled_triggers_guildId_status_runAt_idx" ON "scheduled_triggers"("guildId", "status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_triggers_guildId_cancelKey_key" ON "scheduled_triggers"("guildId", "cancelKey");

-- CreateIndex
CREATE INDEX "event_triggers_guildId_event_enabled_idx" ON "event_triggers"("guildId", "event", "enabled");

-- AddForeignKey
ALTER TABLE "guild_module_states" ADD CONSTRAINT "guild_module_states_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mod_counters" ADD CONSTRAINT "mod_counters_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mod_cases" ADD CONSTRAINT "mod_cases_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_backups" ADD CONSTRAINT "role_backups_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_automations" ADD CONSTRAINT "agent_automations_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_memories" ADD CONSTRAINT "guild_memories_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_memories" ADD CONSTRAINT "member_memories_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_memory_profiles" ADD CONSTRAINT "member_memory_profiles_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_memory_profiles" ADD CONSTRAINT "guild_memory_profiles_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_corrections" ADD CONSTRAINT "memory_corrections_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_cursors" ADD CONSTRAINT "ingestion_cursors_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_agent_settings" ADD CONSTRAINT "guild_agent_settings_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_providers" ADD CONSTRAINT "guild_providers_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_routes" ADD CONSTRAINT "capability_routes_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_routes" ADD CONSTRAINT "capability_routes_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "guild_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_routes" ADD CONSTRAINT "capability_routes_fallbackProviderId_fkey" FOREIGN KEY ("fallbackProviderId") REFERENCES "guild_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_integrations" ADD CONSTRAINT "guild_integrations_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_birthdays" ADD CONSTRAINT "member_birthdays_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sticky_roles" ADD CONSTRAINT "sticky_roles_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "afk_statuses" ADD CONSTRAINT "afk_statuses_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temp_sanctions" ADD CONSTRAINT "temp_sanctions_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_activities" ADD CONSTRAINT "member_activities_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_nodes" ADD CONSTRAINT "tool_nodes_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_records" ADD CONSTRAINT "agent_records_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_rules" ADD CONSTRAINT "guild_rules_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_opt_outs" ADD CONSTRAINT "memory_opt_outs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactive_surfaces" ADD CONSTRAINT "interactive_surfaces_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_triggers" ADD CONSTRAINT "scheduled_triggers_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_triggers" ADD CONSTRAINT "event_triggers_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

