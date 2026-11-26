-- AlterTable
ALTER TABLE "agent_records" ADD COLUMN "channelId" TEXT;
ALTER TABLE "agent_records" ADD COLUMN "messageId" TEXT;

-- CreateIndex
CREATE INDEX "agent_records_guildId_collection_messageId_idx" ON "agent_records"("guildId", "collection", "messageId");
