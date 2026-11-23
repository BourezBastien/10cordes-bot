-- CreateTable
CREATE TABLE "guild_agent_settings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "thinkingMode" TEXT NOT NULL DEFAULT 'adaptive',
    "configThreadId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "guild_agent_settings_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

