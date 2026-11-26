-- SQLite : pas de DROP CONSTRAINT -> recréation avec PK composite.
CREATE TABLE "memory_opt_outs_new" (
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guildId" TEXT NOT NULL,
    PRIMARY KEY ("userId", "guildId"),
    CONSTRAINT "memory_opt_outs_new_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "memory_opt_outs_new" ("userId", "createdAt", "guildId") SELECT "userId", "createdAt", "guildId" FROM "memory_opt_outs";
DROP TABLE "memory_opt_outs";
ALTER TABLE "memory_opt_outs_new" RENAME TO "memory_opt_outs";
