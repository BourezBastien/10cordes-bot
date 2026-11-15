-- CreateTable
CREATE TABLE "admin_whitelist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "agent_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ops" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "results" TEXT,
    "approvedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_whitelist_guildId_userId_key" ON "admin_whitelist"("guildId", "userId");

-- CreateIndex
CREATE INDEX "agent_plans_guildId_status_idx" ON "agent_plans"("guildId", "status");
