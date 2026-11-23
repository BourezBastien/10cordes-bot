-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "runAt" DATETIME,
    "cron" TEXT,
    "tz" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "intervalMinutes" INTEGER,
    "actions" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scheduled_jobs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "scheduled_jobs_guildId_enabled_idx" ON "scheduled_jobs"("guildId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_jobs_guildId_name_key" ON "scheduled_jobs"("guildId", "name");
