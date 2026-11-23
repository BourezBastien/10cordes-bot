-- Moteur générique (Phase 2.4) : surfaces interactives persistantes,
-- triggers planifiés (rattrapage garanti, sans fenêtre de grâce) et
-- triggers événementiels (réactions, voice, member.update...).
CREATE TABLE "interactive_surfaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "definition" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "interactive_surfaces_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "interactive_surfaces_guildId_messageId_key" ON "interactive_surfaces"("guildId", "messageId");
CREATE INDEX "interactive_surfaces_guildId_kind_idx" ON "interactive_surfaces"("guildId", "kind");

CREATE TABLE "scheduled_triggers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "surfaceId" TEXT,
    "cancelKey" TEXT,
    "kind" TEXT NOT NULL,
    "runAt" DATETIME,
    "cron" TEXT,
    "intervalSec" INTEGER,
    "tz" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "condition" TEXT,
    "steps" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'armed',
    "lastRunAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scheduled_triggers_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "scheduled_triggers_guildId_cancelKey_key" ON "scheduled_triggers"("guildId", "cancelKey");
CREATE INDEX "scheduled_triggers_guildId_status_runAt_idx" ON "scheduled_triggers"("guildId", "status", "runAt");

CREATE TABLE "event_triggers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "surfaceId" TEXT,
    "name" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "filter" TEXT NOT NULL DEFAULT '{}',
    "condition" TEXT,
    "steps" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_triggers_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "event_triggers_guildId_event_enabled_idx" ON "event_triggers"("guildId", "event", "enabled");
