# Prompt de reconstrucción V2 — Asset Manager (multi-proyecto)

> **Cómo usar este documento**
>
> Este es el **paso 2** del rediseño: una versión refactorizada, optimizada y ampliada de la app descrita en `REBUILD_PROMPT.md`. Cambia el modelo de datos a multi-proyecto colaborativo y añade un módulo de **ingesta de Excel con diff preview** que permite crear y actualizar el catálogo de KPIs de cada proyecto sin perder evidencias asociadas.
>
> Mantiene el mismo stack (Express 5 + Drizzle + Postgres + React 19 + Vite + shadcn) pero introduce **una capa de servicios real**, **errores tipados**, **cola de jobs persistente**, **observabilidad**, **transacciones explícitas** y **tests**. El objetivo es producir un sistema reutilizable para distintos clientes/proyectos de benchmarking, no sólo ILUNION.

---

## 1. Resumen ejecutivo de cambios respecto a V1

| Tema | V1 | V2 |
|---|---|---|
| Tenancy | Single-tenant ILUNION, sin concepto de proyecto | **Multi-proyecto colaborativo**: cada usuario puede crear proyectos e invitar colaboradores con roles (`owner`, `editor`, `viewer`) |
| Usuarios | Login único `admin / EFQM_2026` | **Usuarios reales** (email + password hasheado con argon2), sesión server-side, registro vía invitación |
| Catálogo KPIs | JSON estático `data/bdd_indicadores_catalog.json` en el repo | **Catálogo por proyecto en BBDD**, ingerido desde Excel + descripción libre del proyecto |
| Contexto del agente | Prompt EFQM hardcodeado en `agent.ts` | **Project context** (descripción + framework opcional) inyectado dinámicamente al system prompt del agente |
| Validación de evidencia | Acoplada a `evidencias` table de ILUNION | Funciona para cualquier proyecto; el RAG y el agente toman el contexto del proyecto |
| Arquitectura backend | Todo en `routes/*.ts` mezclando HTTP + lógica + DB | **Capas separadas**: `routes` (HTTP) → `services` (negocio) → `repositories` (Drizzle) + `validators` (Zod) + `errors` (tipados) |
| Manejo de errores | `res.status(400).json({ error })` ad-hoc en cada handler | **Excepciones tipadas** + error-mapping middleware central + códigos de error estables (`PROJECT_NOT_FOUND`, `KPI_DUPLICATE`, …) |
| Jobs largos | Llamadas HTTP síncronas con timeout 300 s | **Cola de jobs persistente** con `pg-boss` (mismo Postgres): `agent.gather`, `agent.validate`, `excel.ingest`. Frontend hace polling o subscribe a SSE |
| Transacciones | Inserts sueltos | **Todas las mutaciones multi-row** envueltas en `db.transaction(async tx => …)` |
| Tests | Ninguno | **Vitest + Supertest** para servicios y rutas; tests deterministas con DB en memoria (pglite) o testcontainers |
| Observabilidad | `pino` básico | `pino` + `pino-http` con `traceId`, `OpenTelemetry` opcional, healthcheck que reporta status del RAG, dashboard básico de métricas |
| Frontend routing | Una sola página `/` | Rutas anidadas: `/projects`, `/projects/:id`, `/projects/:id/kpis`, `/projects/:id/evidencias`, `/projects/:id/settings`, `/projects/:id/members` |
| Estado servidor | `useListEvidencias({filters})` con cache `staleTime: 30s` | Mismo pero con **`queryKeys` jerarquizados** por proyecto + **optimistic updates** en mark/delete + **prefetching** en navegación |
| Ingest de Excel | No existe | **Pipeline completo**: subida → parsing → preview con diff coloreado → commit transaccional |
| RAG service | API mínima (`/ingest`, `/audit`) | Añade `/preview` (para validaciones desde la UI sin commit), versionado de store por proyecto |
| Power BI | Endpoint con API key estática global | API keys **por proyecto**, revocables, con auditoría de accesos |

---

## 2. Arquitectura por capas (backend)

```
HTTP request
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ middlewares                                              │
│   pinoHttp → cors → cookieParser → session → traceId    │
│   → requireAuth → requireProjectMembership(role?)        │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ routes/*.ts                                              │
│   Parsea params/body con Zod                            │
│   Llama al servicio correspondiente                     │
│   Mapea resultado a JSON / status code                  │
│   No contiene lógica de negocio ni DB                   │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ services/*.ts                                            │
│   Lógica de negocio pura, independiente de Express      │
│   Lanza excepciones tipadas (DomainError subclasses)    │
│   Orquesta repositorios + cola de jobs + agentes IA     │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ repositories/*.ts                                        │
│   Acceso a DB con Drizzle, encapsula queries reutilizables│
│   Recibe `tx` opcional para participar en transacciones │
│   No conoce HTTP ni dominio                             │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ lib/db (Drizzle schema + pool + transaction helper)     │
└─────────────────────────────────────────────────────────┘

  Aparte:
  - lib/errors: clases DomainError, NotFoundError, ConflictError, ValidationError, ForbiddenError + errorHandler middleware
  - lib/jobs: cliente pg-boss y workers
  - lib/excel: parser + validadores + diff
  - lib/agents: clientes Anthropic, prompts versionados
```

Reglas:

- **`routes`** sólo hace I/O HTTP. Sin `try/catch` salvo para casos muy específicos. Los errores se delegan al middleware `errorHandler` final.
- **`services`** son async, devuelven dominio (no `Response`). Reciben un objeto `Ctx { userId, projectId?, tx? }` cuando aplica.
- **`repositories`** exportan funciones puras `(executor, args) => Promise<row>` donde `executor` puede ser `db` o un `tx`. Esto permite componer transacciones desde el servicio.
- **`validators`** centralizan los schemas Zod de entrada/salida. Comparten esquemas con `api-zod` (vía OpenAPI codegen) cuando el shape coincide.

---

## 3. Modelo de datos

Schema completo (Drizzle + Postgres). Las nuevas tablas están marcadas con `★`.

### `users` ★
```ts
pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),          // argon2id
  name: text("name").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  last_login_at: timestamp("last_login_at", { withTimezone: true }),
});
```

### `projects` ★
```ts
pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),                    // p.ej. "ilunion-efqm-2026"
  name: text("name").notNull(),
  description: text("description").notNull(),               // descripción libre del proyecto (se inyecta al system prompt)
  framework: text("framework"),                             // p.ej. "EFQM 2025", "GRI Standards", "ESG", "Custom"
  framework_context: jsonb("framework_context"),            // estructura opcional con criterios/peers/etc.
  created_by: uuid("created_by").notNull().references(() => users.id),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archived_at: timestamp("archived_at", { withTimezone: true }),
});

// Índices
uniqueIndex("projects_slug_idx").on(t.slug);
index("projects_created_by_idx").on(t.created_by);
```

### `project_members` ★
```ts
pgTable("project_members", {
  project_id: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),                              // "owner" | "editor" | "viewer"
  added_by: uuid("added_by").references(() => users.id),
  added_at: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.project_id, t.user_id] }),
  roleCheck: check("role_check", sql`${t.role} in ('owner','editor','viewer')`),
}));
```

Cuando se crea un proyecto, automáticamente se inserta un row `(project_id, created_by, "owner")`.

### `project_invitations` ★
```ts
pgTable("project_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  project_id: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull(),                              // "editor" | "viewer"
  token: text("token").notNull().unique(),                   // 32-byte URL-safe random
  invited_by: uuid("invited_by").notNull().references(() => users.id),
  invited_at: timestamp("invited_at", { withTimezone: true }).defaultNow().notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),  // +7 días
  accepted_at: timestamp("accepted_at", { withTimezone: true }),
});
```

### `kpis` ★ (catálogo por proyecto; sustituye al JSON estático)
```ts
pgTable("kpis", {
  id: uuid("id").defaultRandom().primaryKey(),
  project_id: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  external_code: text("external_code").notNull(),           // código del Excel ("id_data" en V1) — único por proyecto
  name: text("name").notNull(),                              // "indicador"
  scope: text("scope"),                                      // "alcance"
  responsible_area: text("responsible_area"),
  direction: text("direction"),                              // "ASCENDENTE" | "DESCENDENTE" | "NEUTRO"
  comparable_companies: text("comparable_companies").array(),
  standard_unit: text("standard_unit"),                      // "M€", "Personas", "%", "tCO2e", "horas/persona"…
  category: text("category"),                                // criterio EFQM, GRI category, etc.
  description: text("description"),                          // texto largo del KPI (para LLM)
  extra: jsonb("extra"),                                     // columnas Excel adicionales sin esquema fijo
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archived_at: timestamp("archived_at", { withTimezone: true }),
}, t => ({
  uniqExternal: uniqueIndex("kpis_project_external_idx").on(t.project_id, t.external_code),
  projIdx: index("kpis_project_idx").on(t.project_id),
}));
```

### `kpi_ingestion_runs` ★ (auditoría de cada ingesta de Excel)
```ts
pgTable("kpi_ingestion_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  project_id: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  user_id: uuid("user_id").notNull().references(() => users.id),
  filename: text("filename").notNull(),
  file_hash: text("file_hash").notNull(),                    // sha256 del contenido — sirve para detectar re-uploads idénticos
  status: text("status").notNull(),                          // "previewed" | "committed" | "discarded" | "failed"
  summary: jsonb("summary").notNull(),                       // { added, updated, removed, unchanged, conflicts }
  diff: jsonb("diff").notNull(),                             // payload con el detalle del diff
  error: text("error"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  committed_at: timestamp("committed_at", { withTimezone: true }),
});
```

### `evidencias` (renombrada conceptualmente como "evidence records", sigue siendo `evidencias` por compatibilidad SQL)

Mismo schema que V1 pero con dos cambios clave:

```ts
// Cambios respecto a V1:
project_id: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
kpi_id:     uuid("kpi_id").references(() => kpis.id, { onDelete: "set null" }),  // FK fuerte al catálogo del proyecto

// Y se eliminan:
// - id_data (reemplazado por kpi_id)
// - codigo_indicador (se deriva en runtime desde kpis.external_code + kpis.name)
// - pilar_ilunion (campo opcional movido a jsonb extra)

// Índices nuevos
index("evidencias_project_idx").on(t.project_id);
index("evidencias_project_kpi_idx").on(t.project_id, t.kpi_id);
index("evidencias_project_decision_idx").on(t.project_id, t.decision_final);
```

> Migración desde V1: para los datos existentes, crear un proyecto "ILUNION EFQM 2026" como `slug=ilunion-efqm-2026`, importar el catálogo desde `bdd_indicadores_catalog.json`, vincular cada evidencia a su KPI por `id_data`, y luego dropear las columnas obsoletas.

### `api_keys` ★ (Power BI y otros consumidores externos)
```ts
pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  project_id: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),                              // p.ej. "Power BI Dashboard"
  token_hash: text("token_hash").notNull().unique(),         // sha256 del token (el token plano sólo se muestra al crear)
  scopes: text("scopes").array().notNull(),                  // ["evidencias:read"] etc.
  created_by: uuid("created_by").notNull().references(() => users.id),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  last_used_at: timestamp("last_used_at", { withTimezone: true }),
  revoked_at: timestamp("revoked_at", { withTimezone: true }),
});
```

### `job_state` (gestionado por `pg-boss`)
`pg-boss` crea sus propias tablas en el schema `pgboss`. No requiere intervención manual salvo permisos.

---

## 4. Sistema de proyectos

### Crear proyecto (flujo)
1. Usuario logueado pulsa "Nuevo proyecto" en el dashboard.
2. Modal con tres pasos:
   - **Paso 1 — Info básica**: nombre, descripción (textarea libre, mínimo 50 caracteres, máx 5000), framework (select: EFQM 2025 / GRI / ESG genérico / Custom).
   - **Paso 2 — Excel inicial**: drag&drop de `.xlsx` con columnas mínimas `code`, `name` (el resto se mapea heurísticamente, ver §5). Botón "Ver preview".
   - **Paso 3 — Preview & confirmación**: muestra los KPIs detectados (tabla con código, nombre, unidad, peers detectados) y el slug propuesto. El usuario puede editar el slug y confirmar.
3. Al confirmar:
   ```ts
   db.transaction(async tx => {
     const project = await repos.projects.insert(tx, { name, description, framework, slug, created_by: userId });
     await repos.members.insert(tx, { project_id: project.id, user_id: userId, role: "owner" });
     await services.kpiCatalog.commitIngestion(tx, ingestionRunId);
   });
   ```
4. Redirige a `/projects/:id/kpis`.

### Roles y permisos
| Acción | viewer | editor | owner |
|---|---|---|---|
| Ver KPIs y evidencias | ✓ | ✓ | ✓ |
| Crear/editar/borrar evidencias | – | ✓ | ✓ |
| Lanzar agente `gather` o `validate` | – | ✓ | ✓ |
| Ingerir Excel (preview + commit) | – | ✓ | ✓ |
| Editar info del proyecto, descripción, framework | – | – | ✓ |
| Añadir / quitar colaboradores | – | – | ✓ |
| Crear / revocar API keys | – | – | ✓ |
| Archivar / borrar proyecto | – | – | ✓ |

El middleware `requireProjectMembership(roles?: Role[])` valida que el usuario sea miembro y, opcionalmente, que su rol esté en la lista. Devuelve 403 con código `INSUFFICIENT_ROLE` si no.

### Invitar colaboradores
- `POST /api/projects/:id/invitations` `{ email, role }` (owner only) → crea token, devuelve `{ inviteLink }`. Se manda email opcional vía SendGrid/Resend (env `EMAIL_PROVIDER`, opcional).
- `GET /api/invitations/:token` → preview público (proyecto, rol, expiración).
- `POST /api/invitations/:token/accept` → si el usuario tiene cuenta y email coincide, lo añade a `project_members` y marca la invitación como aceptada. Si no tiene cuenta, lo redirige a `/signup?invitation=…`.

---

## 5. Ingesta de Excel — pipeline completo

Hay **una sola operación** "ingest" que se usa tanto para la creación inicial como para actualizaciones posteriores. Siempre pasa por preview antes de aplicarse.

### Endpoint: subir y obtener preview
```
POST /api/projects/:id/kpi-ingestions
Content-Type: multipart/form-data
Body: file (xlsx)
```
Devuelve `IngestionRun` con `status: "previewed"` y un payload `diff` listo para renderizar.

### Endpoint: commit
```
POST /api/projects/:id/kpi-ingestions/:runId/commit
Body opcional: { acceptedChanges?: { add?: string[]; update?: string[]; remove?: string[] } }
```
Si `acceptedChanges` se omite, aplica todo el diff. Si se pasa, sólo aplica los IDs/codes seleccionados.

### Endpoint: descartar
```
DELETE /api/projects/:id/kpi-ingestions/:runId
```

### Pipeline interno
```
┌──────────────────────────┐
│ 1. Recibir XLSX (multer) │
│    máx 10 MB             │
└──────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────┐
│ 2. Calcular sha256(file)                  │
│    Si ya hay un run "committed" reciente  │
│    con el mismo hash → 409 NO_CHANGES     │
└──────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────┐
│ 3. Parser (lib/excel/parser.ts)           │
│    - SheetJS lee primera hoja             │
│    - Detecta header row (busca cabecera   │
│      "código", "code", "id" o similar)    │
│    - Normaliza headers a snake_case ASCII │
│    - Mapea columnas a campos KPI:         │
│        external_code  ← code|codigo|id    │
│        name           ← name|nombre|...   │
│        scope          ← scope|alcance     │
│        direction      ← direction|sentido │
│        standard_unit  ← unit|unidad       │
│        category       ← category|criterio │
│        comparable_companies               │
│          ← peers, separados por "," o ";" │
│        description    ← description|desc  │
│    - Columnas no reconocidas → extra{}    │
└──────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────┐
│ 4. Validar cada fila con Zod              │
│    Acumula errores por fila               │
│    Si > 0 filas con error fatal           │
│      (sin external_code o name) → 422     │
└──────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────┐
│ 5. Diff (lib/excel/differ.ts)             │
│    SELECT current_kpis FROM project       │
│    Compara por external_code:             │
│      - new   : sólo en Excel              │
│      - updated: en ambos, algún campo ≠   │
│      - removed: sólo en BBDD              │
│      - unchanged: en ambos, sin cambios   │
│    Para "updated", incluye field-level    │
│      diff: { campo: { old, new } }        │
└──────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────┐
│ 6. Detectar conflictos                    │
│    - "removed" + evidencias asociadas →   │
│      conflicto (NO se borra, sólo se      │
│      archiva con archived_at=now)         │
│    - "updated" en standard_unit con       │
│      evidencias con valor_estandarizado   │
│      → flag "requires_recompute"          │
└──────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────┐
│ 7. Persistir en kpi_ingestion_runs        │
│    status="previewed", devolver al user   │
└──────────────────────────────────────────┘
```

### Commit (transaccional)
```ts
await db.transaction(async tx => {
  for (const kpi of accepted.added) {
    await repos.kpis.insert(tx, { project_id, ...kpi });
  }
  for (const { id, changes } of accepted.updated) {
    await repos.kpis.update(tx, id, { ...changes, updated_at: now() });
    if (changes.standard_unit) {
      await services.evidence.recomputeStandardised(tx, { project_id, kpi_id: id });
    }
  }
  for (const id of accepted.removed) {
    // Soft delete: archive en vez de DELETE para preservar evidencias
    await repos.kpis.archive(tx, id);
  }
  await repos.ingestions.markCommitted(tx, runId);
});
```

### Preview en frontend
- Vista de 3 paneles (`Tabs`):
  - **Nuevos** (verde): `n` filas con badge `+`. Checkbox para aceptar.
  - **Modificados** (ámbar): `n` filas con diff inline por campo (`old → new`). Checkbox.
  - **Eliminados / Archivados** (rojo): `n` filas, con badge "tiene X evidencias asociadas → se archivará". Checkbox.
- Footer: "Aplicar `m`/`n` cambios" + "Descartar".

### Idempotencia y reintento
- Si el commit falla a mitad, la transacción revierte; el run queda en `previewed` (no `committed`).
- `file_hash` evita re-aplicar el mismo Excel dos veces.

---

## 6. Refactor backend: separación en capas

### Estructura nueva de `artifacts/api-server/src`
```
src/
├── index.ts                      # bootstrap: app.listen + jobs.start
├── app.ts                        # Express app + middlewares + errorHandler
├── env.ts                        # validación de env vars con Zod al arranque
├── logger.ts                     # pino
├── traceId.ts                    # middleware que añade req.traceId (uuid)
│
├── middlewares/
│   ├── requireAuth.ts
│   ├── requireProjectMembership.ts
│   ├── apiKey.ts                  # autenticación por token de project api_keys
│   └── errorHandler.ts            # mapea DomainError → status code + body
│
├── routes/
│   ├── index.ts                   # router raíz
│   ├── health.ts
│   ├── auth.ts                    # signup, login, logout, me
│   ├── users.ts                   # GET /me, PATCH /me
│   ├── projects.ts                # CRUD proyectos, archivar
│   ├── members.ts                 # listado / añadir / cambiar rol / quitar
│   ├── invitations.ts             # crear invitaciones, listar pendientes, accept
│   ├── kpis.ts                    # CRUD KPIs (manual; lo normal es ingest)
│   ├── kpiIngestions.ts           # upload, preview, commit, discard
│   ├── evidencias.ts              # CRUD + stats + options + download (siempre filtrado por project_id)
│   ├── agent.ts                   # gather, validate (encolan jobs)
│   ├── jobs.ts                    # GET /jobs/:id status, GET /jobs (mis jobs activos)
│   ├── apiKeys.ts                 # crear/revocar API keys del proyecto
│   └── powerbi.ts                 # GET /powerbi/:projectSlug/evidencias?apikey=…
│
├── services/
│   ├── auth.service.ts
│   ├── projects.service.ts
│   ├── members.service.ts
│   ├── invitations.service.ts
│   ├── kpis.service.ts
│   ├── kpiIngestion.service.ts    # parse + diff + commit
│   ├── evidence.service.ts
│   ├── agent.service.ts
│   ├── ragClient.ts               # HTTP client del microservicio Python con retries y circuit breaker
│   └── unitConversion.service.ts  # extracto de §6 de V1, parametrizable por proyecto
│
├── repositories/
│   ├── users.repo.ts
│   ├── projects.repo.ts
│   ├── members.repo.ts
│   ├── invitations.repo.ts
│   ├── kpis.repo.ts
│   ├── ingestions.repo.ts
│   ├── evidencias.repo.ts
│   └── apiKeys.repo.ts
│
├── jobs/
│   ├── index.ts                   # pg-boss bootstrap + register workers
│   ├── agentGather.worker.ts
│   ├── agentValidate.worker.ts
│   └── excelIngest.worker.ts      # (opcional si la ingesta tarda)
│
├── lib/
│   ├── errors.ts                  # DomainError + subclases + códigos
│   ├── excel/
│   │   ├── parser.ts
│   │   ├── normalize.ts
│   │   ├── differ.ts
│   │   └── headerHeuristics.ts
│   ├── agents/
│   │   ├── anthropic.client.ts    # singleton con baseURL/apiKey de env
│   │   ├── prompts.efqm.ts        # prompts versionados por framework
│   │   ├── prompts.gri.ts
│   │   ├── prompts.generic.ts
│   │   └── promptBuilder.ts       # ensambla prompt según project.framework
│   └── hashing.ts                 # argon2id helpers + sha256 helper
│
└── tests/
    ├── setup.ts                   # crea schema en pglite o en testcontainer
    ├── projects.spec.ts
    ├── kpiIngestion.spec.ts
    ├── evidence.service.spec.ts
    ├── agent.gather.spec.ts       # con mock de Anthropic
    └── e2e/
        ├── login.e2e.ts
        └── createProject.e2e.ts
```

### Errores tipados (`lib/errors.ts`)
```ts
export type ErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "INSUFFICIENT_ROLE"
  | "PROJECT_NOT_FOUND" | "PROJECT_SLUG_TAKEN"
  | "KPI_NOT_FOUND" | "KPI_DUPLICATE"
  | "EXCEL_PARSE_FAILED" | "EXCEL_NO_CHANGES" | "INGESTION_NOT_FOUND"
  | "EVIDENCE_NOT_FOUND"
  | "INVITATION_INVALID" | "INVITATION_EXPIRED"
  | "VALIDATION_FAILED"
  | "RAG_UNAVAILABLE" | "AGENT_FAILED"
  | "INTERNAL_ERROR";

export class DomainError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
  ) { super(message); }
}

export class NotFoundError extends DomainError {
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(code, message, 404, details);
  }
}
export class ConflictError extends DomainError {
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(code, message, 409, details);
  }
}
export class ValidationError extends DomainError {
  constructor(details: unknown) {
    super("VALIDATION_FAILED", "Validation failed", 422, details);
  }
}
export class ForbiddenError extends DomainError {
  constructor(code: ErrorCode = "FORBIDDEN", message = "Forbidden") {
    super(code, message, 403);
  }
}
```

`errorHandler` middleware:
```ts
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof DomainError) {
    req.log.warn({ code: err.code, traceId: req.traceId, details: err.details }, err.message);
    res.status(err.status).json({ error: err.message, code: err.code, details: err.details ?? null });
    return;
  }
  req.log.error({ err, traceId: req.traceId }, "Unhandled error");
  res.status(500).json({ error: "Internal error", code: "INTERNAL_ERROR", traceId: req.traceId });
};
```

### Cola de jobs (`pg-boss`)
- Una sola dependencia adicional. Usa el mismo Postgres → cero infra extra.
- Endpoints `gather` y `validate` **encolan** y devuelven `{ jobId, status: "queued" }` en lugar de bloquear hasta 5 min.
- Frontend hace polling cada 2 s a `GET /api/jobs/:id` o subscribe a SSE en `GET /api/jobs/:id/events`.
- Permite **cancelar** un job en cola pero no en ejecución (limitación intencional).
- Configurable: `JOB_CONCURRENCY_GATHER=3`, `JOB_CONCURRENCY_VALIDATE=6`.

```ts
// services/agent.service.ts
async function enqueueGather(projectId: string, kpiId: string, userId: string, extra?: string) {
  const jobId = await boss.send("agent.gather", { projectId, kpiId, userId, extra }, {
    retryLimit: 1,
    expireInMinutes: 15,
  });
  return { jobId, status: "queued" as const };
}
```

### RAG client con circuit breaker
- Si 5 requests consecutivos al RAG fallan en < 30 s → abrir circuito 60 s (devuelve `RAG_UNAVAILABLE` inmediatamente).
- El servicio `agent.validate` cae a fase 2 (web_search) automáticamente.

---

## 7. Refactor del frontend

### Estructura nueva de `artifacts/efqm-evidencias` → renombrar a `artifacts/web` (es genérico)
```
src/
├── main.tsx
├── App.tsx                       # QueryClient + Router con rutas anidadas
├── index.css
├── lib/
│   ├── utils.ts                  # cn()
│   ├── queryKeys.ts              # factory: key("projects", projectId, "evidencias", filters)
│   └── api.ts                    # re-export del cliente generado + setBaseUrl
├── hooks/
│   ├── useAuth.tsx
│   ├── useCurrentProject.ts      # extrae projectId de la URL + valida que existe
│   ├── useProjectRole.ts         # devuelve el rol del usuario en el proyecto actual
│   └── use-toast.ts
├── components/
│   ├── ui/                       # shadcn (igual que V1)
│   ├── layouts/
│   │   ├── RootLayout.tsx        # header global con ProjectSwitcher + user menu
│   │   └── ProjectLayout.tsx     # sidebar con tabs (KPIs, Evidencias, Miembros, Ajustes)
│   ├── ProjectSwitcher.tsx       # combobox con tus proyectos + "Nuevo proyecto"
│   ├── RoleGate.tsx              # <RoleGate allow={["owner","editor"]}>...</RoleGate>
│   ├── DiffTable.tsx             # vista de diff para ingest Excel
│   ├── EvidenceTable.tsx         # igual que V1
│   ├── EvidenceFilters.tsx
│   ├── EvidenceStats.tsx
│   ├── EvidenceFormModal.tsx
│   ├── AgentSearchModal.tsx
│   ├── AgentValidateModal.tsx
│   ├── KpiTable.tsx              # tabla del catálogo
│   ├── KpiFormModal.tsx          # alta/edición manual de KPI
│   ├── ExcelDropzone.tsx         # drag&drop con feedback
│   ├── IngestionPreview.tsx      # tabs Nuevos/Modificados/Eliminados
│   ├── MembersTable.tsx
│   ├── InviteMemberModal.tsx
│   ├── ApiKeysTable.tsx
│   └── JobToast.tsx              # tracker de jobs activos en esquina inferior
└── pages/
    ├── Login.tsx
    ├── Signup.tsx
    ├── AcceptInvite.tsx
    ├── Projects.tsx              # listado de tus proyectos + botón "Nuevo"
    ├── NewProject.tsx            # wizard de 3 pasos
    ├── project/
    │   ├── Overview.tsx          # estadísticas del proyecto
    │   ├── Kpis.tsx              # catálogo + botón "Importar Excel"
    │   ├── KpiIngest.tsx         # vista de preview del diff
    │   ├── Evidencias.tsx        # como V1
    │   ├── Members.tsx
    │   ├── ApiKeys.tsx
    │   └── Settings.tsx          # editar nombre/descripción/framework, archivar
    └── not-found.tsx
```

### Rutas (wouter)
```
/                               → redirect a /projects
/login                          → Login.tsx
/signup                         → Signup.tsx
/invitations/:token             → AcceptInvite.tsx
/projects                       → Projects.tsx (lista)
/projects/new                   → NewProject.tsx (wizard)
/projects/:id                   → project/Overview.tsx
/projects/:id/kpis              → project/Kpis.tsx
/projects/:id/kpis/import       → project/KpiIngest.tsx (upload)
/projects/:id/kpis/import/:run  → project/KpiIngest.tsx (preview)
/projects/:id/evidencias        → project/Evidencias.tsx
/projects/:id/members           → project/Members.tsx
/projects/:id/api-keys          → project/ApiKeys.tsx
/projects/:id/settings          → project/Settings.tsx
```

### Patrón de query keys (jerárquico)
```ts
// lib/queryKeys.ts
export const qk = {
  me: () => ["me"] as const,
  projects: () => ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  kpis: (projectId: string) => ["projects", projectId, "kpis"] as const,
  evidencias: (projectId: string, filters?: object) =>
    ["projects", projectId, "evidencias", filters ?? {}] as const,
  members: (projectId: string) => ["projects", projectId, "members"] as const,
  job: (jobId: string) => ["jobs", jobId] as const,
};

// Invalidar todo un proyecto:
queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
```

### Optimistic updates
En `EvidenceTable` para acciones "marcar OK / DESCARTAR" y "eliminar":
```ts
const mutation = useUpdateEvidencia({
  mutation: {
    onMutate: async ({ id, data }) => {
      const key = qk.evidencias(projectId);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (rows: Evidencia[] = []) =>
        rows.map(r => r.id === id ? { ...r, ...data } : r));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && queryClient.setQueryData(qk.evidencias(projectId), ctx.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.evidencias(projectId) }),
  },
});
```

### `RoleGate` para ocultar acciones según rol
```tsx
<RoleGate allow={["owner", "editor"]}>
  <Button onClick={onAddNew}>Añadir evidencia</Button>
</RoleGate>
```

---

## 8. RAG service — cambios respecto a V1

Mantiene la misma estructura general (`/health`, `/ingest`, `/audit`, `/fetch`) pero:

1. **Store namespaced por proyecto**: `chunk` ahora incluye `project_id` y todas las queries filtran por él. Esto evita que evidencias de distintos clientes se contaminen entre sí.
2. **Nuevo endpoint `/preview`**: igual que `/audit` pero **sin commit** (sólo devuelve el resultado). Permite que el frontend muestre "previsualización de validación" antes de marcar como `OK`.
3. **Persistencia por proyecto**: `/tmp/rag_store_${project_id}.pkl` en vez de un store global. Permite hacer "purgar caché del proyecto X" desde la UI sin afectar al resto.
4. **Healthcheck enriquecido**: devuelve `chunks_per_project: { [project_id]: count }`.
5. **Soporte de PDF mejorado**: en V1 los PDFs se marcaban como "URL accesible" sin extraer texto. En V2 usar `pypdf` (ligero) para extraer texto si la URL es PDF, fallback al string genérico si falla.

---

## 9. Nuevos endpoints (resumen)

Convención: todos los endpoints scoped en un proyecto comienzan por `/api/projects/:id/...` y aplican `requireAuth + requireProjectMembership`.

```
# Auth & usuarios
POST   /api/auth/signup                          {email, password, name}
POST   /api/auth/login                           {email, password}
POST   /api/auth/logout
GET    /api/auth/me
PATCH  /api/auth/me                              {name?}

# Proyectos
GET    /api/projects                             → proyectos del usuario
POST   /api/projects                             {name, description, framework, slug?}
GET    /api/projects/:id
PATCH  /api/projects/:id                         (owner)
POST   /api/projects/:id/archive                 (owner)
DELETE /api/projects/:id                         (owner)

# Miembros & invitaciones
GET    /api/projects/:id/members
PATCH  /api/projects/:id/members/:userId         {role}     (owner)
DELETE /api/projects/:id/members/:userId         (owner)
POST   /api/projects/:id/invitations             {email, role} (owner)
GET    /api/projects/:id/invitations             (owner)
DELETE /api/projects/:id/invitations/:invId      (owner)
GET    /api/invitations/:token                   (público)
POST   /api/invitations/:token/accept            (auth)

# KPIs (catálogo)
GET    /api/projects/:id/kpis
GET    /api/projects/:id/kpis/:kpiId
POST   /api/projects/:id/kpis                    (editor)
PATCH  /api/projects/:id/kpis/:kpiId             (editor)
DELETE /api/projects/:id/kpis/:kpiId             (editor)   # soft-delete (archive)

# Ingestas Excel
POST   /api/projects/:id/kpi-ingestions          (editor)   multipart/form-data file
GET    /api/projects/:id/kpi-ingestions          (viewer)   historial
GET    /api/projects/:id/kpi-ingestions/:runId   (viewer)   detalle + diff
POST   /api/projects/:id/kpi-ingestions/:runId/commit (editor) {acceptedChanges?}
DELETE /api/projects/:id/kpi-ingestions/:runId   (editor)

# Evidencias
GET    /api/projects/:id/evidencias
POST   /api/projects/:id/evidencias              (editor)
GET    /api/projects/:id/evidencias/:evId
PATCH  /api/projects/:id/evidencias/:evId        (editor)
DELETE /api/projects/:id/evidencias/:evId        (editor)
GET    /api/projects/:id/evidencias/stats
GET    /api/projects/:id/evidencias/options
GET    /api/projects/:id/evidencias/download     # xlsx o json

# Agente IA
POST   /api/projects/:id/agent/gather            (editor)   {kpi_id, extra?} → {jobId}
POST   /api/projects/:id/agent/validate          (editor)   {evidence_id}    → {jobId}
POST   /api/projects/:id/agent/validate-batch    (editor)   {evidence_ids[]} → {jobId}
GET    /api/jobs/:jobId                          → status + result si terminado
GET    /api/jobs/:jobId/events                   → SSE

# API keys (Power BI etc.)
GET    /api/projects/:id/api-keys
POST   /api/projects/:id/api-keys                (owner)    {name, scopes[]}  → devuelve token plano UNA SOLA VEZ
DELETE /api/projects/:id/api-keys/:keyId         (owner)    # revoca

# Power BI (sin sesión, con apikey)
GET    /api/powerbi/:projectSlug/evidencias?apikey=...
```

---

## 10. Tests

### Backend (`vitest` + `supertest`)
- **Unit** (services + repositorios + lib/excel): casos felices y de borde. ~80 % de cobertura objetivo en `services` y `lib/excel`.
- **E2E**: arrancan la app con DB de test (pglite o testcontainers Postgres), ejecutan flujos completos:
  - signup → login → crear proyecto → ingerir Excel inicial → ver KPIs.
  - invitar colaborador → aceptar invitación → editor crea evidencia.
  - re-ingerir Excel modificado → preview diff correcto → commit.
  - agente gather con Anthropic mockeado.
- **Mocks**: cliente Anthropic se mockea con `vi.mock("@anthropic-ai/sdk")`. RAG service se mockea con `msw` o un fixture HTTP.

### Frontend (`vitest` + `@testing-library/react`)
- **Unit**: componentes con props varias, hooks (`useAuth`, `useCurrentProject`).
- **Integration**: páginas críticas con `react-query` test client + `msw` mockeando la API.
- **Smoke E2E** opcional: Playwright con un solo flujo "login → crear proyecto → ingerir Excel" contra un backend de test real.

### CI sugerido
- GitHub Actions con dos jobs: `backend` (typecheck + tests + build) y `frontend` (typecheck + tests + build).
- Postgres en service container para los tests E2E.

---

## 11. Variables de entorno (V2)

| Variable | Uso | Default |
|---|---|---|
| `DATABASE_URL` | Postgres | obligatoria |
| `PORT`, `BASE_PATH` | Como V1 | obligatorias |
| `SESSION_SECRET` | argon2id rotable | obligatoria en prod |
| `ARGON2_SECRET` | pepper para password_hash | obligatoria en prod |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | LLM | obligatorias en prod |
| `OPENAI_API_KEY` | Embeddings RAG | obligatoria |
| `RAG_URL` | `http://localhost:8000` | configurable |
| `RAG_PORT` | Puerto del servicio Python | 8000 |
| `JOB_CONCURRENCY_GATHER`, `JOB_CONCURRENCY_VALIDATE` | Concurrencia jobs | 3 / 6 |
| `EMAIL_PROVIDER` | `none` \| `resend` \| `sendgrid` | `none` (no envía emails) |
| `EMAIL_FROM` | Sender | `noreply@local` |
| `RESEND_API_KEY` / `SENDGRID_API_KEY` | Según provider | opcionales |
| `STORAGE_DIR` | Carpeta para subidas temporales de Excel | `/tmp/uploads` |
| `LOG_LEVEL` | pino level | `info` |

Validación al arranque con Zod en `env.ts` — falla rápido si falta algo crítico.

---

## 12. Migración desde V1

Plan en 4 PRs:

**PR1 — Infraestructura nueva sin romper V1**
- Añade `users`, `projects`, `project_members`, `kpis`, `kpi_ingestion_runs`, `api_keys` (todas nuevas, no tocan `evidencias`).
- Implementa auth real con `users` + argon2.
- Mantiene endpoints V1 funcionando.

**PR2 — Migrar `evidencias` a multi-proyecto**
- Añadir columnas `project_id` y `kpi_id` (nullable al principio).
- Script de migración: crea proyecto "ILUNION EFQM 2026", importa `bdd_indicadores_catalog.json` como KPIs, asocia cada evidencia con su KPI por `id_data`, rellena `project_id`.
- Cuando todas las rows tengan `project_id` y `kpi_id` → poner `NOT NULL` y dropear `id_data`, `codigo_indicador`, `pilar_ilunion`.

**PR3 — Refactor en capas + jobs + ingesta de Excel**
- Crear `services/`, `repositories/`, `lib/excel/`.
- Añadir `pg-boss` y workers.
- Endpoints nuevos de proyectos, miembros, ingestas.
- Reescribir `routes/*.ts` para delegar en servicios.

**PR4 — Frontend con nuevas rutas y wizard**
- Reestructurar pages con `project/*`.
- `ProjectSwitcher`, `RoleGate`, `DiffTable`, `IngestionPreview`.
- Wizard de nuevo proyecto.
- Mantener pantallas V1 accesibles vía deep-link a `/projects/ilunion-efqm-2026/...`.

---

## 13. Optimizaciones técnicas concretas

1. **DB**
   - Índices compuestos para queries comunes: `(project_id, decision_final)`, `(project_id, kpi_id)`, `(project_id, created_at)`.
   - Vistas materializadas para `stats` de cada proyecto, refrescadas al hacer mutaciones (o cada 5 min via `pg-boss` schedule).
   - Connection pool con `max=10` por proceso, `idle_timeout=30s`.
   - `pg-boss` archive automático con `archiveCompletedAfter='7 days'`.

2. **Backend**
   - **No bundling de imports JSON al runtime**: el catálogo ya está en BBDD, esbuild deja de cargar `bdd_indicadores_catalog.json`. Reduce el bundle de ~200 KB.
   - **Schema cache** en memoria: `kpis` por proyecto se cachea con `lru-cache` (TTL 60 s) — el agente consulta el catálogo muchas veces por job.
   - **Stream del download**: en vez de cargar todas las evidencias en memoria, usar `db.select().stream()` (Drizzle) y `res.write()` chunked. Necesario cuando un proyecto tenga > 10 k evidencias.
   - **Compresión**: `compression()` middleware en respuestas > 1 KB.

3. **Frontend**
   - **Code splitting** por ruta con `lazy()` + `Suspense`. La página `KpiIngest` carga `xlsx` sólo cuando se entra.
   - **Lazy import de SheetJS** ya estaba en V1; mantener.
   - **Prefetch** en hover de los enlaces "Evidencias" / "KPIs": `queryClient.prefetchQuery` para que la transición sea instantánea.
   - **Persisted query cache** opcional con `@tanstack/query-persist-client` (localStorage) para que los listados se vean al instante en navegaciones.
   - **Skeleton loaders** en lugar de spinners centrados (mejor LCP percibido).

4. **Agente IA**
   - **Cache de prompts**: hash(prompt) → resultado válido durante 7 días para `gather` (los datos públicos cambian poco). Saltarlo con `force=true`.
   - **Batch en `/validate`**: nuevo endpoint `validate-batch` que recibe hasta 50 IDs y los procesa en un único job worker, paralelizando. Ahorra round-trips desde el frontend.
   - **Métricas por job**: tokens, coste, duración, mecanismo (RAG vs web_search), guardadas en `kpi_ingestion_runs.summary` análogo.

5. **Observabilidad**
   - `traceId` propagado: header `x-trace-id` ↔ campo en logs ↔ devuelto en errores 5xx para que el usuario pueda reportar.
   - `/metrics` endpoint en formato Prometheus (`pino-http` + `prom-client`) con counters por ruta, histograma de latencia y gauges de jobs activos.
   - Logs estructurados: `{ traceId, userId, projectId, route, latencyMs, status }`.

6. **Seguridad**
   - **CSP** en `app.ts` con `helmet`. Permitir sólo `'self'` + Google Fonts + el dominio del proyecto.
   - **Rate limiting** con `express-rate-limit` en `/auth/login` (5 intentos por IP por minuto) y en `/agent/*` (límite por usuario y por proyecto).
   - **Audit log**: tabla `audit_log` opcional con `(user_id, project_id, action, target_type, target_id, at, ip, ua)` para `login`, `kpi.commit`, `evidencia.delete`, `member.add`, `apikey.create`.

---

## 14. Prompt para Claude Code

> Reconstruye el proyecto **Asset Manager** (versión 2, multi-proyecto colaborativo) siguiendo la especificación de este documento. Es un monorepo pnpm + TypeScript igual al stack actual (Express 5 + Drizzle + Postgres + React 19 + Vite + shadcn/ui + Tailwind v4 + microservicio Python FastAPI), pero con cuatro diferencias estructurales clave respecto a la V1:
>
> 1. **Multi-proyecto colaborativo**: usuarios reales (`users` + argon2id), proyectos con descripción libre y framework (`projects`), colaboradores con roles `owner/editor/viewer` (`project_members`), invitaciones por token con expiración.
> 2. **Catálogo de KPIs por proyecto en BBDD** alimentado desde **Excel**: subida con `multer`, parser SheetJS, mapeo heurístico de columnas, validación Zod por fila, **diff vs catálogo actual** y commit transaccional con preview en frontend. El mismo pipeline cubre creación inicial y actualizaciones posteriores. Soft-delete con `archived_at` cuando hay evidencias asociadas.
> 3. **Backend en capas estrictas**: `routes → services → repositories`, errores tipados (`DomainError + ErrorCode`), middleware `errorHandler` central, **cola de jobs con pg-boss** para `gather/validate/excel-ingest` (los endpoints devuelven `{jobId}` y el frontend hace polling / SSE), RAG client con circuit breaker, validación de env vars al arranque con Zod.
> 4. **Frontend reestructurado** con rutas anidadas (`/projects`, `/projects/:id/{kpis,evidencias,members,settings,api-keys}`), `ProjectSwitcher` en el header, `RoleGate` para ocultar acciones por rol, `DiffTable` y `IngestionPreview` para el flujo de ingesta Excel, query keys jerárquicos, optimistic updates en mark/delete.
>
> Implementa también: tests con vitest + supertest (servicios y E2E con pglite), API keys por proyecto (token mostrado una sola vez al crear, hashed en BBDD), métricas Prometheus, audit log, rate limiting en login y agentes, índices compuestos en Postgres.
>
> Orden de trabajo:
> 1. **PR1**: schema nuevo (`users`, `projects`, `project_members`, `kpis`, `kpi_ingestion_runs`, `project_invitations`, `api_keys`), capa de errores tipados, middleware `errorHandler`, auth real con signup/login, scaffolding de `services` y `repositories`.
> 2. **PR2**: migración de `evidencias` a multi-proyecto (script + columnas `project_id`/`kpi_id`).
> 3. **PR3**: `pg-boss` + workers, refactor de agentes a servicios, RAG client con circuit breaker, pipeline completo de ingesta Excel (`lib/excel/{parser,differ,normalize}`).
> 4. **PR4**: frontend con rutas anidadas, `ProjectSwitcher`, wizard `NewProject` de 3 pasos, `IngestionPreview` con tabs Nuevos/Modificados/Eliminados, vistas de Members/ApiKeys/Settings.
>
> Reglas a respetar:
> - **Toda mutación que toque más de una tabla debe ir en `db.transaction()`.**
> - **Ningún `try/catch` en `routes/*.ts`** — los errores se delegan al `errorHandler`.
> - **El microservicio Python NO debe importar lógica del backend Node**; se comunica sólo por HTTP. Añade `project_id` a todas las llamadas para namespaced storage.
> - **Catálogo en runtime**: el agente lee `kpis` por proyecto desde DB en cada job, nunca desde JSON estático.
> - **`description` del proyecto + `framework_context` se inyectan al system prompt del agente** vía `promptBuilder.ts` (un builder por framework: EFQM, GRI, genérico).
> - **El re-ingest de Excel preserva los `id` de los KPIs existentes** (matching por `external_code`); jamás los borra físicamente si tienen evidencias asociadas — sólo `archived_at = now()`.
> - **API keys**: el token plano se muestra una única vez en la respuesta de creación; en BBDD se guarda `sha256(token)` y se valida por hash en el middleware `apiKey`.
> - **Sin secrets hardcoded** en código: el password admin `EFQM_2026` de V1 desaparece; los usuarios se crean por signup o invitación.
>
> Si encuentras ambigüedades durante la implementación (p.ej. cómo mapear una columna de Excel cuyo header no encaja con la heurística), **pregunta antes de inventar**. No introduzcas tecnologías que no estén en la lista del stack: nada de NestJS, GraphQL, tRPC, Next.js, Prisma o Hono — el stack se conserva intencionalmente.

---

## 15. Diferencias resumidas de un vistazo

```
V1                                              V2
────────────────────────────────────            ────────────────────────────────────
1 cliente (ILUNION), 1 catálogo                 N clientes, N catálogos por proyecto
JSON estático en data/                          BBDD + ingesta Excel con diff
Login fijo admin/EFQM_2026                      Usuarios reales + invitaciones
1 rol implícito                                 owner / editor / viewer
Rutas + lógica + DB mezcladas                   routes → services → repositories
Errores ad-hoc                                  DomainError + códigos estables
Jobs síncronos (300s timeout)                   pg-boss + polling/SSE
Sin transacciones explícitas                    Todas las mutaciones multi-row en tx
Prompts hardcoded EFQM                          promptBuilder por framework
Single store RAG global                         Store namespaced por project_id
1 endpoint Power BI con token estático global   API keys por proyecto, revocables
Sin tests                                       vitest + supertest + msw
Sin observabilidad                              traceId + métricas + audit log
```

---

*Documento V2 generado tras escanear el repositorio en `C:\Users\rjcol\Desktop\Codigo\Asset-Manager` y aplicar las decisiones de rediseño acordadas (multi-usuario colaborativo, upsert con diff preview, mismo stack con refactor profundo).*
