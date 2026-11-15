-- CreateTable
CREATE TABLE "guild_memories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "member_memories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "guild_memories_guildId_idx" ON "guild_memories"("guildId");

-- CreateIndex
CREATE INDEX "member_memories_guildId_userId_idx" ON "member_memories"("guildId", "userId");
