-- CreateTable
CREATE TABLE "member_memory_profiles" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("guildId", "userId")
);

-- CreateTable
CREATE TABLE "guild_memory_profiles" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);
