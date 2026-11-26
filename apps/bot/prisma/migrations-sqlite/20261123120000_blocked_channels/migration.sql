-- R : blockedChannelIds dans guild_rules (MUET total meme mention).
ALTER TABLE "guild_rules" ADD COLUMN "blockedChannelIds" TEXT NOT NULL DEFAULT '[]';
