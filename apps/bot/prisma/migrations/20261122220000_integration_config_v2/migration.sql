-- R2 : IntegrationConfig étendue (kind, label) + baseUrl/model par défaut vides.
ALTER TABLE "IntegrationConfig" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'tool';
ALTER TABLE "IntegrationConfig" ADD COLUMN "label" TEXT NOT NULL DEFAULT '';
ALTER TABLE "IntegrationConfig" ALTER COLUMN "baseUrl" SET DEFAULT '';
