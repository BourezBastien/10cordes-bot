-- R2 : IntegrationConfig étendue (kind, label) + baseUrl/model par défaut vides.
ALTER TABLE "IntegrationConfig" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'tool';
ALTER TABLE "IntegrationConfig" ADD COLUMN "label" TEXT NOT NULL DEFAULT '';
-- Note : ALTER COLUMN SET DEFAULT n existe pas en SQLite ; baseUrl est déjà créé avec DEFAULT vide dans la migration précédente.
