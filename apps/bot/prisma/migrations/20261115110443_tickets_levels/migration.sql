-- CreateTable
CREATE TABLE "ticket_counters" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "claimedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME
);

-- CreateTable
CREATE TABLE "user_levels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "tickets_guildId_userId_idx" ON "tickets"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_guildId_channelId_key" ON "tickets"("guildId", "channelId");

-- CreateIndex
CREATE INDEX "user_levels_guildId_xp_idx" ON "user_levels"("guildId", "xp");

-- CreateIndex
CREATE UNIQUE INDEX "user_levels_guildId_userId_key" ON "user_levels"("guildId", "userId");
