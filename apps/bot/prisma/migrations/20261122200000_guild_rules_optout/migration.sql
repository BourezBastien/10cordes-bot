-- R0.4/R0.5 : règles serveur appliquées en code + opt-out mémoire.
CREATE TABLE "guild_rules" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "freeCategoryIds" TEXT NOT NULL DEFAULT '[]',
    "freeChannelIds" TEXT NOT NULL DEFAULT '[]',
    "strictMentionElsewhere" BOOLEAN NOT NULL DEFAULT true,
    "seriousOnlyElsewhere" BOOLEAN NOT NULL DEFAULT false,
    "confirmDestructiveActions" BOOLEAN NOT NULL DEFAULT false,
    "customInstructions" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "guild_rules_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "memory_opt_outs" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guildId" TEXT NOT NULL,
    CONSTRAINT "memory_opt_outs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
