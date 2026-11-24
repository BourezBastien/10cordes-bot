-- Moteur multi-fournisseurs : un serveur connecte autant de fournisseurs
-- qu'il veut (GuildProvider) et associe chaque capacité du bot à un modèle
-- (CapabilityRoute). Additive : rien n'est supprimé ni déplacé, les lignes
-- IntegrationConfig existantes restent en place (migration de données à part).
-- Appliquée à la main sur la base de dev (db execute + migrate resolve).

-- CreateTable
CREATE TABLE "guild_providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'bearer',
    "authHeaderName" TEXT,
    "encryptedApiKey" TEXT,
    "customHeadersJson" TEXT,
    "extraConfigJson" TEXT,
    "cachedModelsJson" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "guild_providers_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "capability_routes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "fallbackProviderId" TEXT,
    "fallbackModelId" TEXT,
    "paramsJson" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "capability_routes_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "capability_routes_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "guild_providers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "capability_routes_fallbackProviderId_fkey" FOREIGN KEY ("fallbackProviderId") REFERENCES "guild_providers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "guild_providers_guildId_enabled_idx" ON "guild_providers"("guildId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "guild_providers_guildId_slug_key" ON "guild_providers"("guildId", "slug");

-- CreateIndex
CREATE INDEX "capability_routes_guildId_enabled_idx" ON "capability_routes"("guildId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "capability_routes_guildId_capability_key" ON "capability_routes"("guildId", "capability");
