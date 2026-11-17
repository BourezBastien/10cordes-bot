-- CreateTable
CREATE TABLE "channel_watermarks" (
    "channelId" TEXT NOT NULL PRIMARY KEY,
    "lastMessageId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
