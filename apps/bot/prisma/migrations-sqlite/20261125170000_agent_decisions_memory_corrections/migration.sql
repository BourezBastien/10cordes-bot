-- Journal des décisions de l'agent (une ligne par demande traitée par le modèle,
-- purge à 14 jours) et corrections de mémoire (un fait corrigé qui prime sur
-- le reste ; les entrées périmées du journal sont marquées, jamais supprimées).
-- Additive : rien n'est supprimé ni déplacé.
-- Appliquée à la main sur la base de dev (db execute + migrate resolve).

-- AlterTable
ALTER TABLE "guild_memories" ADD COLUMN "supersededAt" DATETIME;

-- AlterTable
ALTER TABLE "member_memories" ADD COLUMN "supersededAt" DATETIME;

-- CreateTable
CREATE TABLE "memory_corrections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT,
    "oldFact" TEXT NOT NULL,
    "newFact" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" DATETIME,
    CONSTRAINT "memory_corrections_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_decisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "memory_corrections_guildId_userId_idx" ON "memory_corrections"("guildId", "userId");

-- CreateIndex
CREATE INDEX "agent_decisions_guildId_createdAt_idx" ON "agent_decisions"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_decisions_createdAt_idx" ON "agent_decisions"("createdAt");
