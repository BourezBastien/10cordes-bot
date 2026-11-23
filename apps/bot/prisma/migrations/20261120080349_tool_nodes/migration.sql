-- CreateTable
CREATE TABLE "tool_nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    CONSTRAINT "tool_nodes_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "tool_nodes_guildId_targetId_tool_key" ON "tool_nodes"("guildId", "targetId", "tool");
