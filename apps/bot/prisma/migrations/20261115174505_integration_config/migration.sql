-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'custom',
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);
