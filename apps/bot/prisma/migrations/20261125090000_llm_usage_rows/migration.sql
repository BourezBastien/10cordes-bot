-- Journal des appels au modèle, par serveur : jetons, modèle, durée, issue.
-- Alimente la page Système du dashboard (jetons sur 24 h, 7 j et 30 j).
-- Additive : rien n'est supprimé ni déplacé.
-- Appliquée à la main sur la base de dev (db execute + migrate resolve).

-- CreateTable
CREATE TABLE "llm_usage_rows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "requestId" TEXT,
    "cause" TEXT NOT NULL,
    "capability" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "llm_usage_rows_guildId_createdAt_idx" ON "llm_usage_rows"("guildId", "createdAt");
