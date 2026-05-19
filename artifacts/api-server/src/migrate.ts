/**
 * Migraciones idempotentes ejecutadas al arranque del API y por el script
 * `dist/migrate.mjs` en el flujo de deploy.
 *
 * En lugar de usar `drizzle-kit migrate`, aplicamos un único SQL "garantizar
 * estado" porque queremos arranque seguro en cada container start. Si
 * necesitas migraciones versionadas, usa `pnpm --filter @workspace/db run generate`
 * y aplica los SQL resultantes con `drizzle-kit migrate`.
 */
import { getPool } from "@workspace/db";
import { logger } from "./logger.js";

const SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

CREATE TABLE IF NOT EXISTS projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL,
  name              text NOT NULL,
  description       text NOT NULL,
  framework         text,
  framework_context jsonb,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_idx ON projects(slug);
CREATE INDEX IF NOT EXISTS projects_created_by_idx ON projects(created_by);

CREATE TABLE IF NOT EXISTS project_members (
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL,
  added_by    uuid REFERENCES users(id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT role_check CHECK (role IN ('owner','editor','viewer'))
);

CREATE TABLE IF NOT EXISTS project_invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email         text NOT NULL,
  role          text NOT NULL,
  token         text NOT NULL UNIQUE,
  invited_by    uuid NOT NULL REFERENCES users(id),
  invited_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  CONSTRAINT invitation_role_check CHECK (role IN ('editor','viewer'))
);
CREATE INDEX IF NOT EXISTS invitations_project_idx ON project_invitations(project_id);
CREATE INDEX IF NOT EXISTS invitations_email_idx ON project_invitations(email);

CREATE TABLE IF NOT EXISTS kpis (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_code         text NOT NULL,
  name                  text NOT NULL,
  scope                 text,
  responsible_area      text,
  direction             text,
  comparable_companies  text[],
  standard_unit         text,
  category              text,
  description           text,
  extra                 jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS kpis_project_external_idx ON kpis(project_id, external_code);
CREATE INDEX IF NOT EXISTS kpis_project_idx ON kpis(project_id);

CREATE TABLE IF NOT EXISTS kpi_schema_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  header_signature  text NOT NULL,
  sheet_name        text NOT NULL,
  header_row        integer NOT NULL,
  column_mapping    jsonb NOT NULL,
  skip_rows         integer[] NOT NULL DEFAULT '{}',
  notes             text,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz,
  uses_count        integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS kpi_schema_templates_proj_sig_idx ON kpi_schema_templates(project_id, header_signature);

CREATE TABLE IF NOT EXISTS kpi_ingestion_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  filename      text NOT NULL,
  file_hash     text NOT NULL,
  status        text NOT NULL,
  summary       jsonb NOT NULL,
  diff          jsonb NOT NULL,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  committed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS ingestions_project_idx ON kpi_ingestion_runs(project_id);
CREATE INDEX IF NOT EXISTS ingestions_status_idx ON kpi_ingestion_runs(status);

CREATE TABLE IF NOT EXISTS evidencias (
  id                       serial PRIMARY KEY,
  project_id               uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kpi_id                   uuid REFERENCES kpis(id) ON DELETE SET NULL,
  empresa_comparable       text NOT NULL,
  entidad_fuente           text,
  ano                      integer,
  codigo_indicador         text,
  indicador                text,
  categoria_efqm           text,
  pilar_ilunion            text,
  id_data                  text,
  fuente_nivel             text,
  fuente_tipo              text NOT NULL,
  fuente_titulo            text,
  url_validada             text,
  ubicacion_fuente         text,
  texto_evidencia          text,
  valor_reportado          double precision,
  unidad                   text,
  comparabilidad           text,
  observacion_metodologica text,
  decision_final           text,
  definicion_referencia    text,
  unidad_base_referencia   text,
  indicador_fuente         text,
  encaje_indicador         text,
  estado_auditoria         text,
  tipo_compania            text,
  unidad_estandarizada     text,
  valor_estandarizado      double precision,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidencias_project_idx ON evidencias(project_id);
CREATE INDEX IF NOT EXISTS evidencias_project_kpi_idx ON evidencias(project_id, kpi_id);
CREATE INDEX IF NOT EXISTS evidencias_project_decision_idx ON evidencias(project_id, decision_final);
CREATE INDEX IF NOT EXISTS evidencias_project_created_idx ON evidencias(project_id, created_at);

CREATE TABLE IF NOT EXISTS evidencia_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  filename      text NOT NULL,
  file_hash     text NOT NULL,
  mode          text NOT NULL,
  status        text NOT NULL,
  summary       jsonb NOT NULL,
  diff          jsonb NOT NULL,
  errors        jsonb,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  committed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS evidencia_imports_project_idx ON evidencia_imports(project_id);
CREATE INDEX IF NOT EXISTS evidencia_imports_status_idx ON evidencia_imports(status);

CREATE TABLE IF NOT EXISTS api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          text NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  scopes        text[] NOT NULL,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS api_keys_project_idx ON api_keys(project_id);

-- Migraciones idempotentes para columnas añadidas tras el primer deploy.
ALTER TABLE evidencias ADD COLUMN IF NOT EXISTS codigo_indicador text;
ALTER TABLE evidencias ADD COLUMN IF NOT EXISTS pilar_ilunion    text;
ALTER TABLE evidencias ADD COLUMN IF NOT EXISTS id_data          text;
`;

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  logger.info("Ejecutando migraciones idempotentes...");
  await pool.query(SQL);
  logger.info("Migraciones OK");
}

// El entry CLI (`dist/migrate.mjs`) vive en `src/cli/migrate.ts` — así no se
// inlina dentro de `dist/index.mjs` y no provoca un `process.exit()` durante
// el arranque del servidor.
