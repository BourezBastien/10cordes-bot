-- CreateTable
CREATE TABLE "agent_skills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "agent_skills_guildId_deletedAt_idx" ON "agent_skills"("guildId", "deletedAt");
