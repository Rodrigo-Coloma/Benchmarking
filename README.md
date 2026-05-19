# Asset Manager

Plataforma multi-proyecto de benchmarking y validación de evidencias.
Esqueleto del monorepo construido a partir de los documentos
`REBUILD_PROMPT.md` (V1), `REBUILD_PROMPT_V2.md` (V2) y
`REBUILD_PROMPT_V3.md` (V3).

> Esta entrega cubre **PR1 de V2** (schema multi-proyecto, auth, roles,
> capas, pg-boss), **PR2 de V3** (ingesta de evidencias con schema fijo),
> **PR3 de V3** (parser estructural + descubridor IA del catálogo de KPIs)
> y **PR4 de V3** (Dockerfiles, Docker Compose, Nginx vhost para
> `rcoloma.dev/evidencias`, scripts de deploy/backup, CI con GitHub Actions).
> Queda PR5 (frontend completo de ingesta + workers reales del RAG cuando se
> integre el servicio Python).

---

## Estructura

```
.
├── artifacts/
│   ├── api-server/        # Backend Express 5 + Drizzle + pg-boss
│   └── web/               # Frontend Vite + React 19 + wouter + react-query
│
├── lib/
│   ├── db/                # Schema Drizzle (Postgres) y pool
│   ├── api-spec/          # OpenAPI 3.1 + orval.config.ts
│   ├── api-zod/           # Schemas Zod generados por Orval
│   └── api-client-react/  # Hooks generados + custom-fetch
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── tsconfig.json
```

## Requisitos

- **Node.js 22+**
- **pnpm 9+** (`corepack enable && corepack prepare pnpm@latest --activate`)
- **PostgreSQL 16+** accesible (local o remoto)
- Opcional: claves de Anthropic y OpenAI para PR3 (no necesarias en PR1)

## Primera puesta en marcha

```bash
# 1. Instalar dependencias del workspace
pnpm install

# 2. Configurar el entorno
cp .env.example .env
# edita .env y pon una DATABASE_URL real

# 3. Crear esquema de DB
#    Las migraciones idempotentes corren automáticamente al arrancar el API,
#    pero también puedes empujar el schema explícitamente con Drizzle:
pnpm db:push

# 4. Generar el cliente HTTP y los schemas Zod desde el OpenAPI spec
pnpm codegen
#    (esto rellena lib/api-zod/src/generated y lib/api-client-react/src/generated)

# 5. Arrancar backend y frontend en paralelo (dos terminales)
pnpm dev:api    # http://localhost:8080/api/healthz
pnpm dev:web    # http://localhost:5173
```

Si quieres añadir componentes shadcn/ui reales, ejecuta una sola vez en
`artifacts/web/`:

```bash
cd artifacts/web
npx shadcn@latest init        # respeta el components.json que ya está creado
npx shadcn@latest add button input label dialog form table
```

El `Button` provisional de `src/components/Button.tsx` se puede borrar una vez
exista `src/components/ui/button.tsx`.

## Scripts útiles

| Comando | Descripción |
|---|---|
| `pnpm typecheck` | TypeScript check en todo el monorepo |
| `pnpm build` | Typecheck + build de cada paquete |
| `pnpm dev:api` | Arranca el backend en modo watch (`tsx watch`) |
| `pnpm dev:web` | Arranca Vite |
| `pnpm codegen` | Regenera cliente y schemas Zod desde `openapi.yaml` |
| `pnpm db:push` | `drizzle-kit push` (sólo dev) |
| `pnpm test` | Vitest en todos los paquetes que lo declaran |

## Ingesta de evidencias (PR2)

Pipeline en dos fases — preview + commit — con auditoría persistente:

```
POST /api/projects/:id/evidencias/import          (multipart, mode=upsert|replace)
  → parsea XLSX con schema fijo (19 columnas A..S)
  → resuelve kpi_external_code contra el catálogo del proyecto
  → calcula diff (new / updated / unchanged / kpi_not_found)
  → si mode=replace, marca filas a eliminar
  → persiste un `evidencia_imports` row con status="previewed"
  → devuelve { run, summary }

GET    /api/projects/:id/evidencias/imports
GET    /api/projects/:id/evidencias/imports/:runId      (devuelve el diff completo)
POST   /api/projects/:id/evidencias/imports/:runId/commit  (aplica en una transacción)
DELETE /api/projects/:id/evidencias/imports/:runId

GET    /api/projects/:id/evidencias/template.xlsx       (plantilla con 4 hojas)
GET    /api/projects/:id/evidencias/download.xlsx       (export simétrico)
```

Características clave:

- **Clave natural** `(project_id, kpi_external_code, empresa_comparable, ano)`.
- **Modo `replace`** requiere escribir el nombre exacto del proyecto en
  `confirm_project_name` (similar al borrado de repos en GitHub).
- **Idempotencia**: `sha256(file)` se guarda en `evidencia_imports.file_hash`.
  Si re-subes un archivo ya committeado → 409 `EXCEL_NO_CHANGES`.
- **Plantilla** generada con `exceljs`: incluye `instrucciones`, `kpis`
  (catálogo del proyecto read-only) y `enums` con data validation nativa
  para `fuente_nivel`, `comparabilidad`, `decision_final`.

## Ingesta IA del catálogo de KPIs (PR3)

Pipeline que mezcla IA con cacheo determinístico (V3 §2):

```
POST /api/projects/:id/kpi-ingestions               (multipart: file)
  1. buildStructure(buffer) → muestras 30×30 de cada hoja + header_signature
  2. ¿Existe template aprobado para este header_signature?
       SÍ → aplicar mapping cacheado (0 coste de IA)
       NO → llamar a claude-haiku-4-5 con prompts canónicos de V3 §2 →
            validar JSON con Zod + verificar cabeceras Levenshtein ≤ 2 →
            reintento UNA vez con feedback si falla
  3. applyDeterministicMapping(schema) → rows ParsedKpi
  4. buildKpiDiff(current, parsed) → { new, updated, removed, unchanged }
  5. Persistir run con status="previewed"
  6. Responder { run, needs_review, template_used, discovery: { usage, … } }

POST /api/projects/:id/kpi-ingestions/:runId/commit
  Body opcional:
    override_schema     — reescribe el mapping antes de aplicar (UI puede editarlo)
    accepted_changes    — { add[], update[], remove[] } para commits parciales

  En una transacción:
    - INSERT new        (los que estén en accepted_changes.add o todos)
    - UPDATE updated
    - kpis_repo.archive removed  (jamás DELETE — preserva evidencias)
    - upsert kpi_schema_templates (incrementa uses_count si ya existía)
    - markCommitted(run)

GET    /api/projects/:id/kpi-ingestions
GET    /api/projects/:id/kpi-ingestions/:runId           (run + diff)
DELETE /api/projects/:id/kpi-ingestions/:runId           (descartar)
GET    /api/projects/:id/kpi-schema-templates            (mappings cacheados)
```

Decisiones clave:

- **El LLM nunca toca evidencias**. Sólo descubre la estructura del Excel
  de catálogo. La ingesta de evidencias (PR2) es 100 % determinística.
- **Coste**: `claude-haiku-4-5` con `temperature=0`, `max_tokens=2048`.
  Estimado < $0.005 por descubrimiento. Tras el primer Excel, el formato
  se cachea y los siguientes ahorran 100 % del coste.
- **`removed` es soft-delete**: nunca borra físicamente un KPI con evidencias
  asociadas (V3 §5). El frontend muestra "se archivarán N filas".
- **`needs_review = true`** cuando la confianza media del descubridor cae
  por debajo de 0.5 o hay cabeceras dudosas — la UI debe forzar revisión
  humana antes del commit.

## Endpoints implementados (PR1)

- `GET    /api/healthz`
- `POST   /api/auth/signup` · `POST /api/auth/login` · `POST /api/auth/logout`
- `GET    /api/auth/me` · `PATCH /api/auth/me`
- `GET    /api/projects` · `POST /api/projects`
- `GET    /api/projects/:id` · `PATCH /api/projects/:id`
- `POST   /api/projects/:id/archive` · `DELETE /api/projects/:id`
- `GET    /api/projects/:id/members` · `PATCH/DELETE /api/projects/:id/members/:userId`
- `GET    /api/projects/:id/invitations` · `POST /api/projects/:id/invitations`
- `DELETE /api/projects/:id/invitations/:invId`
- `GET    /api/invitations/:token` · `POST /api/invitations/:token/accept`
- `GET    /api/projects/:id/kpis` · `POST /api/projects/:id/kpis`
- `GET    /api/projects/:id/kpis/:kpiId` · `PATCH/DELETE /api/projects/:id/kpis/:kpiId`
- `GET/POST/PATCH/DELETE /api/projects/:id/evidencias[…]`
- `GET/POST/DELETE /api/projects/:id/api-keys[…]`
- `GET    /api/jobs/:jobId` (scaffolding — se rellena en PR3)

## Roadmap

- ✅ **PR1** — Schema multi-proyecto, auth, roles, capas, pg-boss scaffolding.
- ✅ **PR2** — Ingesta de evidencias con schema fijo (V3 §3): plantilla,
  diff preview, upsert por clave natural, modo replace con confirmación.
- ✅ **PR3** — Parser estructural + descubridor IA + cache de mappings
  (V3 §2): claude-haiku-4-5 con prompts canónicos, validación post-respuesta
  con Levenshtein, reintento con feedback, soft-delete de KPIs con evidencia.
- ✅ **PR4** — Docker Compose + Nginx vhost + Cloudflare + subpath
  `/evidencias` (V3 §4): Dockerfiles multi-stage, scripts de deploy/backup,
  systemd timer, GitHub Actions con SSH deploy. Ver [`deploy/README.md`](./deploy/README.md).
- ⏳ **PR5** — Frontend completo de ingesta (preview con tabs, drag&drop,
  revisión de mapping IA), workers reales para gather/validate cuando
  el servicio RAG Python se integre, tests E2E con pglite.

Para los detalles funcionales/contractuales consulta los tres `REBUILD_PROMPT_*.md`
en la raíz; son la fuente de verdad del rediseño.
