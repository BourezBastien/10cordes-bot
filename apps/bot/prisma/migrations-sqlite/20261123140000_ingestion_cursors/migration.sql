-- CreateTable
CREATE TABLE "ingestion_cursors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL DEFAULT '',
    "lastMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "errorMessage" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ingestion_cursors_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_IntegrationConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'tool',
    "label" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT 'custom',
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_IntegrationConfig" ("apiKey", "baseUrl", "id", "kind", "label", "model", "provider", "updatedAt") SELECT "apiKey", "baseUrl", "id", "kind", "label", "model", "provider", "updatedAt" FROM "IntegrationConfig";
DROP TABLE "IntegrationConfig";
ALTER TABLE "new_IntegrationConfig" RENAME TO "IntegrationConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_cursors_guildId_channelId_key" ON "ingestion_cursors"("guildId", "channelId");

