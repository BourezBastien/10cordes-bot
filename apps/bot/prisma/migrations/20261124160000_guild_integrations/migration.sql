-- Intégrations par serveur : une API spécialisée (PixelLab...) avec la clé
-- propre à ce serveur, chiffrée. Ce n'est pas un fournisseur de modèles IA :
-- les routes de capacités ne pointent jamais ici. Sans ligne, l'intégration
-- d'instance (IntegrationConfig) sert. Additive : rien n'est supprimé ni déplacé.
-- Appliquée à la main sur la base de dev (db execute + migrate resolve).

-- CreateTable
CREATE TABLE "guild_integrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "baseUrl" TEXT,
    "encryptedApiKey" TEXT,
    "configJson" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "guild_integrations_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "guild_integrations_guildId_slug_key" ON "guild_integrations"("guildId", "slug");
