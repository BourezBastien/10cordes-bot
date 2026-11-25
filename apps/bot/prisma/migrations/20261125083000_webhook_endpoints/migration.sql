-- Connecteurs HTTP sortants par serveur : un endpoint REST qu'un déclencheur
-- ou une recette appelle (outil webhook.call). URL publique validée, en-têtes
-- secrets chiffrés. Additive : rien n'est supprimé ni déplacé.
-- Appliquée à la main sur la base de dev (db execute + migrate resolve).

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "url" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "authHeaderName" TEXT,
    "encryptedHeaders" TEXT,
    "publicHeadersJson" TEXT,
    "requestTemplateJson" TEXT,
    "responseExtractPath" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastHttpStatus" INTEGER,
    "lastCheckedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "webhook_endpoints_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_endpoints_guildId_slug_key" ON "webhook_endpoints"("guildId", "slug");

-- CreateIndex
CREATE INDEX "webhook_endpoints_guildId_idx" ON "webhook_endpoints"("guildId");
