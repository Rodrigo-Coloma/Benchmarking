# Prompt de reconstrucción — ILUNION EFQM Evidencias (Asset-Manager)

> **Cómo usar este documento**
>
> Copia el contenido entero como prompt inicial para Claude Code (`claude` CLI). Es una **especificación funcional y técnica completa** del proyecto: con esta información Claude Code debería poder reconstruir el repositorio desde cero, fichero a fichero, sin necesidad de acceso al original.
>
> El proyecto es un **monorepo pnpm + TypeScript** con backend Node (Express 5 + Drizzle + Postgres), frontend React 19 (Vite + shadcn/ui + Tailwind v4) y un microservicio Python (FastAPI + LangChain + ChromaDB en memoria) para validación RAG. Resuelve un caso de negocio muy concreto: **gestionar y validar evidencias de benchmarking EFQM 2025 para ILUNION Hotels** (Grupo Social ONCE).

---

## 1. Objetivo del producto

Aplicación web de gestión de evidencias para la **acreditación EFQM 2025** de **ILUNION Hotels** (Grupo Social ONCE). Permite a un equipo de auditores:

1. Mantener una base de datos de "evidencias" numéricas extraídas de informes públicos (EINF, memorias de sostenibilidad, web corporativa, certificaciones, prensa) de empresas comparables (peers).
2. Buscar nuevas evidencias automáticamente con un **agente IA (Claude Haiku + web_search)** que recorre la web pública y devuelve un JSON estructurado conforme al esquema EFQM.
3. **Prevalidar** las evidencias importadas mediante un **pipeline RAG** propio (crawl + embeddings OpenAI + ChromaDB + LLM auditor) que verifica que el valor declarado figura realmente en la fuente.
4. Estandarizar valores a unidades comunes (M€, EUR, Personas, %, tCO2e, horas/persona…) para permitir comparabilidad real entre empresas.
5. Filtrar/ordenar la tabla, ver estadísticas, descargar a Excel, exponer los datos a Power BI vía endpoint con API key.

La aplicación es **single-tenant** y está protegida por login básico (usuario/contraseña fija configurable por env).

---

## 2. Stack tecnológico

### Monorepo
- **Gestor**: `pnpm` (workspaces), Node.js 24, TypeScript 5.9
- **Toolchain Python**: 3.11 (sólo para `scripts/rag_service.py`)
- **Plataforma de despliegue original**: Replit (autoscale), pero el código no depende de Replit (Postgres + Node estándar)

### Backend (`artifacts/api-server`)
- **Framework**: Express 5 + `pino` + `pino-http`
- **ORM**: Drizzle ORM 0.45 + `drizzle-zod` + `drizzle-kit` (push schema)
- **DB**: PostgreSQL 16 (`pg` 8.20)
- **Sesiones**: `express-session` (cookie httpOnly, `efqm.sid`)
- **Validación**: Zod (`zod/v4`)
- **Build**: `esbuild` → bundle ESM único (`dist/index.mjs`)
- **LLM**: `@anthropic-ai/sdk` 0.89, modelo `claude-haiku-4-5` con herramienta `web_search_20250305` (vía proxy de Replit AI Integrations)

### Frontend (`artifacts/efqm-evidencias`)
- **Framework**: React 19 + Vite 7
- **Routing**: `wouter` (mínimo, basado en hooks)
- **Estado servidor**: `@tanstack/react-query` 5
- **UI**: **shadcn/ui** (style `new-york`, base color `neutral`) + Radix UI primitives + Tailwind CSS v4 (`@tailwindcss/vite`) + `tw-animate-css`
- **Formularios**: `react-hook-form` + `@hookform/resolvers` + Zod
- **Iconos**: `lucide-react`
- **Toasts**: `sonner` + propio `useToast`
- **Cliente HTTP**: cliente custom (`customFetch`) generado por **Orval** desde un spec OpenAPI 3.1 (`lib/api-spec/openapi.yaml`)
- **Excel**: `xlsx` (SheetJS) para exportar la tabla

### Microservicio RAG (`scripts/rag_service.py`)
- **HTTP**: FastAPI + uvicorn
- **Fetching**: `requests` → fallback `crawl4ai==0.8.5` (Chromium stealth, sólo si `libgbm` está disponible)
- **Chunking**: `RecursiveCharacterTextSplitter` (500 chars / 80 overlap)
- **Embeddings**: `OpenAIEmbeddings` con `text-embedding-3-large` (3072 dims)
- **Vector store**: in-memory `list[dict]` con `numpy` cosine-similarity + persistencia pickle en `/tmp/rag_store.pkl` (versionado `v4-large-3072`)
- **LLM**: `langchain_anthropic.ChatAnthropic` con `claude-haiku-4-5` vía Replit AI Integrations
- **Puerto**: 8000 (configurable con `RAG_PORT`)

---

## 3. Estructura del monorepo

```
Asset-Manager/
├── package.json                       # workspace root (pnpm)
├── pnpm-workspace.yaml                # incluye artifacts/*, lib/*, lib/integrations/*, scripts
├── pnpm-lock.yaml
├── tsconfig.base.json                 # opciones TS estrictas, target es2022, moduleResolution bundler
├── tsconfig.json                      # composite, references todas las libs/artifacts
├── .replit                            # workflow Replit (RAG service como proceso paralelo, 4 puertos)
├── .replitignore
├── .npmrc                             # auto-install-peers=false, strict-peer-dependencies=false
├── .gitignore                         # dist, node_modules, .replit (.cache, .local), etc.
├── replit.md                          # documentación interna (overview, stack, comandos, agentes)
├── pyproject.toml                     # (Python project metadata, opcional)
│
├── artifacts/                         # apps desplegables
│   ├── api-server/                    # backend Express
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── build.mjs                  # bundling esbuild → dist/index.mjs (ESM)
│   │   └── src/
│   │       ├── index.ts               # bootstrap: app.listen + runMigrations + maybeSeedEvidencias
│   │       ├── app.ts                 # Express app + middlewares (cors, pinoHttp, session, json)
│   │       ├── seed.ts                # auto-seed desde data/evidencias_seed.json + migraciones idempotentes
│   │       ├── lib/logger.ts          # pino logger
│   │       ├── middlewares/
│   │       │   └── requireAuth.ts     # gate por session.user
│   │       ├── utils/
│   │       │   └── tipoCompania.ts    # clasifica empresa → "ILUNION" | "ONCE" | "Externa"
│   │       └── routes/
│   │           ├── index.ts           # monta /healthz, /auth, /evidencias, /agent, /powerbi
│   │           ├── health.ts          # GET /healthz
│   │           ├── auth.ts            # POST /login, /logout, GET /me
│   │           ├── evidencias.ts      # CRUD + /download, /stats, /options
│   │           ├── agent.ts           # POST /agent/gather (Claude+web_search), /agent/validate (RAG+fallback web_search), GET /agent/catalog
│   │           └── powerbi.ts         # GET /powerbi/evidencias (auth por API key, p/ Power BI Web connector)
│   │
│   ├── efqm-evidencias/               # frontend React (servido en /)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts             # plugins: react, tailwindcss, runtimeErrorOverlay, (replit cartographer/dev-banner si REPL_ID)
│   │   ├── components.json            # shadcn config (style new-york, aliases @/components etc.)
│   │   ├── index.html                 # Inter font preconnect, #root
│   │   ├── public/                    # favicon.svg, opengraph.jpg
│   │   └── src/
│   │       ├── main.tsx               # createRoot
│   │       ├── App.tsx                # QueryClient + Wouter + AuthProvider + Gate (Login si !user, Home si user)
│   │       ├── index.css              # tailwind v4 + variables shadcn
│   │       ├── lib/utils.ts           # cn() (clsx + tailwind-merge)
│   │       ├── hooks/
│   │       │   ├── useAuth.tsx        # AuthProvider/useAuth (fetch /api/auth/me, login, logout)
│   │       │   ├── use-toast.ts       # adapter shadcn → sonner
│   │       │   └── use-mobile.tsx
│   │       ├── pages/
│   │       │   ├── Home.tsx           # header con botones (Descargar, Prevalidar, Buscar IA, Añadir, Logout) + Stats + Filtros + Tabla
│   │       │   ├── Login.tsx          # formulario user/pass
│   │       │   └── not-found.tsx
│   │       └── components/
│   │           ├── EvidenceTable.tsx          # tabla ordenable + acciones (link URL, OK, DESCARTAR, editar, eliminar)
│   │           ├── EvidenceFilters.tsx        # search box + 6 selects (indicador, empresa, fuente, comparabilidad, decisión, tipo compañía)
│   │           ├── EvidenceStats.tsx          # 4 KPIs (total, empresas, OK, comparabilidad Alta)
│   │           ├── EvidenceFormModal.tsx      # alta/edición con react-hook-form + Zod
│   │           ├── AgentSearchModal.tsx       # selección de KPI del catálogo + lanzamiento concurrente (CONCURRENCY=3) de POST /agent/gather
│   │           ├── AgentValidateModal.tsx     # corre POST /agent/validate sobre todas las decision_final="NUEVA" (CONCURRENCY=6) con tres-icon result
│   │           └── ui/                        # ~50 componentes shadcn (Accordion, AlertDialog, Button, Card, Dialog, Drawer, Form, Input, Label, Popover, Progress, Select, Sheet, Sidebar, Switch, Table, Tabs, Toast/Toaster, Tooltip, …)
│   │
│   └── mockup-sandbox/                # (artifact opcional vacío con la misma plantilla — se puede omitir)
│
├── lib/                               # paquetes internos (no deployables)
│   ├── db/
│   │   ├── package.json               # exports: ".", "./schema"
│   │   ├── drizzle.config.ts          # apunta a src/schema/index.ts, dialect postgresql
│   │   └── src/
│   │       ├── index.ts               # crea pool + drizzle(pool, { schema }) y re-exporta schema
│   │       └── schema/
│   │           ├── index.ts           # export * from "./evidencias"
│   │           └── evidencias.ts      # pgTable "evidencias" + insertEvidenciaSchema (drizzle-zod)
│   │
│   ├── api-spec/
│   │   ├── package.json               # script "codegen": orval + patch al index.ts de api-zod
│   │   ├── orval.config.ts            # 2 outputs: react-query client + zod schemas
│   │   └── openapi.yaml               # spec OpenAPI 3.1 con todos los endpoints y schemas
│   │
│   ├── api-zod/
│   │   ├── package.json               # zod (catalog), exports "."
│   │   └── src/
│   │       ├── index.ts               # export * from "./generated/api"
│   │       └── generated/api.ts       # GENERADO por orval — no editar a mano
│   │
│   └── api-client-react/
│       ├── package.json               # @tanstack/react-query (catalog), peer react
│       └── src/
│           ├── index.ts               # re-exports api + custom-fetch
│           ├── custom-fetch.ts        # fetch wrapper (credentials:"include", ApiError, ResponseParseError, base URL & bearer hooks)
│           └── generated/
│               ├── api.ts             # GENERADO por orval (hooks useListEvidencias, …)
│               └── api.schemas.ts     # GENERADO
│
├── scripts/                           # workspace package "@workspace/scripts"
│   ├── package.json                   # tsx, hello demo
│   ├── tsconfig.json
│   ├── requirements.txt               # Python deps: fastapi, uvicorn, pydantic, numpy, requests, langchain-*, crawl4ai==0.8.6
│   ├── rag_service.py                 # microservicio FastAPI (ver §5)
│   ├── ingestion.py                   # (helpers chunking/embeddings)
│   ├── vector_store.py                # (helpers store)
│   ├── auditor_agent.py               # (LLM auditor LangChain)
│   ├── fetch_url.py                   # (helper crawl4ai/requests)
│   ├── seed-from-xlsx.ts              # script TS de seeding inicial desde Excel
│   ├── start_prod.sh                  # arranque prod: pip install + playwright install chromium + RAG en background + API
│   ├── post-merge.sh                  # hook: pnpm install + pnpm --filter db push
│   ├── src/hello.ts
│   └── test_*.py                      # scripts de benchmarking de tokens/coste
│
├── data/                              # JSON estáticos cargados en runtime
│   ├── bdd_indicadores_catalog.json   # 54 KPIs (id_data, indicador, alcance, sentido, area_responsable, empresas_comparables[], unidad_estandarizada)
│   ├── bdd_indicadores.json           # variante extendida
│   ├── benchmarking_EFQM.json         # snapshot inicial benchmarking
│   └── evidencias_seed.json           # rows de evidencias para seed inicial (vacío salvo en deploys reales)
│
├── attached_assets/                   # ficheros adjuntos del usuario (Excel originales, JSON exportados)
├── backups/                           # snapshots de la BBDD (timestamped JSON)
└── docs/
    └── REBUILD_PROMPT.md              # ESTE archivo
```

---

## 4. Modelo de datos

### Tabla `evidencias` (PostgreSQL)

Definida en `lib/db/src/schema/evidencias.ts` con Drizzle ORM (`pgTable`). Equivalente SQL:

```sql
CREATE TABLE evidencias (
  id                        SERIAL PRIMARY KEY,
  empresa_comparable        TEXT        NOT NULL,
  entidad_fuente            TEXT,
  ano                       INTEGER,
  codigo_indicador          TEXT        NOT NULL,    -- p.ej. KPI_1_PLANTILLA_TOTAL_PERSONAS
  indicador                 TEXT,                    -- nombre humano del KPI
  categoria_efqm            TEXT,                    -- criterio EFQM (1.1, 3.2…)
  pilar_ilunion             TEXT,                    -- (reservado, nullable)
  fuente_nivel              TEXT,                    -- "Nivel 1"…"Nivel 5"
  fuente_tipo               TEXT        NOT NULL,    -- EINF / Web corporativa / Certificación / Prensa / Estimación …
  fuente_titulo             TEXT,
  url_validada              TEXT,
  ubicacion_fuente          TEXT,                    -- "p. 34", "tabla 12", "sección 3.2"…
  texto_evidencia           TEXT,                    -- cita textual breve
  valor_reportado           DOUBLE PRECISION,
  unidad                    TEXT,                    -- unidad tal cual aparece en la fuente
  comparabilidad            TEXT,                    -- Alta | Media | Baja | No comparable
  observacion_metodologica  TEXT,
  decision_final            TEXT,                    -- NUEVA | OK | PREVALIDADO IA | DESCARTAR | REVISION MANUAL | No aplica | Pendiente
  definicion_referencia     TEXT,
  unidad_base_referencia    TEXT,
  indicador_fuente          TEXT,                    -- cómo lo llamaba la fuente original
  encaje_indicador          TEXT,
  estado_auditoria          TEXT,                    -- "Pendiente revisión IA" tras agent/gather
  id_data                   TEXT,                    -- FK lógica al catálogo (string del id_data del catálogo)
  tipo_compania             TEXT,                    -- ILUNION | ONCE | Externa (autocalculado)
  unidad_estandarizada      TEXT,                    -- copia de catálogo.unidad_estandarizada
  valor_estandarizado       DOUBLE PRECISION,        -- valor_reportado convertido a unidad_estandarizada (NULL si no convertible)
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Convenciones clave**

- `codigo_indicador` se genera al insertar desde el agente IA como `KPI_${id_data}_${INDICADOR_NORMALIZADO}` (uppercase ASCII, separador `_`, máx. 60 chars).
- `tipo_compania` se calcula con `classifyTipoCompania()` (regex: `\bilunion\b` → ILUNION; `\bonce\b`, `\bfundosa\b`, `grupo social once`, `fundacion once` → ONCE; resto → Externa).
- `unidad_estandarizada` + `valor_estandarizado` se rellenan al INSERT y tras cada VALIDATE/UPDATE usando el mapa `catalogUnitMap` (id_data → unidad_estandarizada del catálogo) y `conversionFactor()` (ver §6).

### Catálogo de KPIs (`data/bdd_indicadores_catalog.json`)

Array de ~54 entradas, cada una:

```json
{
  "id_data": "1",
  "indicador": "Plantilla total Personas",
  "alcance": "ILUNION",
  "area_responsable": "Area Personas",
  "sentido": "ASCENDENTE",            // ASCENDENTE | DESCENDENTE | NEUTRO
  "empresas_comparables": ["Eulen", "Clece (ACS)", "Sodexo España", "ISS Iberia", …],
  "unidad_estandarizada": "Personas"  // M€ | EUR | Personas | % | tCO2e | horas/persona | horas | veces | Seguidores | Puntos NPS | Puntos/100 | …
}
```

Este catálogo se importa con `import catalogJson from "../../../../data/bdd_indicadores_catalog.json" with { type: "json" };` (asegurar `resolveJsonModule:true` y `module: esnext` en TS).

---

## 5. API REST — detalle endpoint por endpoint

Spec canónico: `lib/api-spec/openapi.yaml` (OpenAPI 3.1, base path `/api`).

Todos los endpoints excepto `/healthz`, `/auth/*` y `/powerbi/*` requieren sesión iniciada (middleware `requireAuth` → 401 `{ "error": "No autenticado" }`).

### `/healthz`
- `GET /api/healthz` → `{ status: "ok" }`. Sin auth.

### `/auth`
- `POST /api/auth/login` body `{ username, password }`. Compara contra `ADMIN_USERNAME` / `ADMIN_PASSWORD` (defaults `admin` / `EFQM_2026`). Setea `req.session.user = { username }`. Cookie `efqm.sid`, httpOnly, sameSite=lax, maxAge 7 días.
- `POST /api/auth/logout` → destruye sesión + `clearCookie("efqm.sid")`.
- `GET /api/auth/me` → `{ user }` o 401.

### `/evidencias` (CRUD + utilidades)
- `GET /api/evidencias?codigo_indicador&indicador&empresa_comparable&fuente_tipo&comparabilidad&decision_final&tipo_compania&search` — Lista con filtros opcionales (todos `ilike %x%`, salvo `comparabilidad`, `decision_final`, `tipo_compania` que son `eq`). `search` = OR `ilike` sobre 7 campos. Ordenado por `created_at`.
- `POST /api/evidencias` — body validado con `CreateEvidenciaBody` (Zod generado). Si `tipo_compania` no viene, se autocalcula. Devuelve 201 + row.
- `GET /api/evidencias/download` — Content-Disposition attachment, JSON con TODAS las rows (luego el frontend lo convierte a XLSX con SheetJS).
- `GET /api/evidencias/stats` → `{ total, by_decision[], by_comparabilidad[], by_codigo_indicador[] (sorted desc), empresas_count }`. Todos via `count(*)::int` + `groupBy`.
- `GET /api/evidencias/options` → distinct values por cada campo filtrable (9 arrays).
- `GET /api/evidencias/:id` → row o 404.
- `PUT /api/evidencias/:id` — body `UpdateEvidenciaBody`. Recalcula `tipo_compania` si cambia `empresa_comparable`.
- `DELETE /api/evidencias/:id` → 204.

### `/agent` — Agentes IA
- `GET /api/agent/catalog` → array de KPIs del catálogo (`CatalogEntry[]`).

- `POST /api/agent/gather` body `{ id_data: string, extra_instructions?: string }` — **agente de búsqueda**.
  - Busca el KPI por `id_data` en el catálogo.
  - Bucle con **hasta 5 intentos** y **budget total de 250 s** (margen ante timeout 300 s del proxy).
  - En cada intento:
    1. Lee evidencias existentes en BBDD del mismo `id_data` (excluyendo `DESCARTAR`).
    2. Construye un bloque compacto "BBDD — excluir empresa+año ya existentes" (≤ 30 entradas, separa COMPLETAS de PARCIALES).
    3. Llama a `claude-haiku-4-5` con `max_tokens=8192`, herramienta `web_search_20250305` (`max_uses=15`), `timeout=6_000_000` ms, system prompt fijo (ver §7) + user prompt dinámico con KPI, peers sugeridos del catálogo, bloque BBDD, contador `[Intento i/5: m/20 evidencias]` y `extra_instructions`.
    4. Parsea el bloque `<evidencias>[...]</evidencias>` (regex), filtra pares `(empresa, año)` ya existentes, inserta el resto con `decision_final="NUEVA"`, `estado_auditoria="Pendiente revisión IA"`, `id_data`, `tipo_compania` auto, `codigo_indicador` derivado.
    5. **Detección de saturación**: si ≥ 80 % de los resultados son duplicados, inyecta un `highDuplicateNote` que ordena buscar en peers menos evidentes y excluye nominalmente las empresas ya conocidas. Tras 2 intentos consecutivos con 0 inserts → corta el bucle.
    6. Para hasta acumular **20 evidencias** totales (`existingNuevaCount + insertados`) o agotar intentos/budget.
  - Devuelve `{ message, inserted: Evidencia[], usage: { input_tokens, output_tokens, estimated_cost_usd } }`. Coste estimado: input $1/M + output $5/M.

- `POST /api/agent/validate` body `{ id: number }` — **agente de validación de una evidencia**. Pipeline en dos fases:
  - **FASE 1 — RAG** (`scripts/rag_service.py`, HTTP localhost:8000):
    1. `POST /ingest` con `{ url, empresa, kpi, ano }` → crawlea la URL (requests → crawl4ai), chunkea (500/80), embebe con `text-embedding-3-large`, guarda en store. Idempotente por `key = url|empresa|kpi|ano`.
    2. `POST /audit` con la evidencia entera → recupera top-3 chunks propios + top-2 de peers (mismo `kpi`, distinta `empresa`), umbral cosine `>0.25`. **Fast path**: si top score > 0.65 y el valor (normalizado sin separadores) aparece literalmente en el chunk → devuelve `OK` sin llamar al LLM. Si no, llama a `claude-haiku-4-5` (LangChain) con `max_tokens=200`, prompt compacto (≤ ~600 tokens) y devuelve `{ resultado, razon, chunks_usados, recuperacion_ok, valor_corregido?, unidad_corregida? }`.
    3. Si RAG da resultado confiable (`recuperacion_ok` o `resultado != REVISION MANUAL`) → commit: `decision_final = "PREVALIDADO IA"|"DESCARTAR"|"REVISION MANUAL"`. Si hay `valor_corregido` numérico-puro distinto del original, actualiza `valor_reportado` (+ `unidad`). Recalcula `valor_estandarizado` con `computeStdValue()`.
  - **FASE 2 — Fallback Claude + web_search**:
    1. Si RAG falla o es inconcluso, llama a `claude-haiku-4-5` con `web_search_20250305` (`max_uses=2`, `timeout=120000`) con un prompt mínimo y devuelve `{"resultado","razon"}`.
    2. Mismo commit que FASE 1 pero sin posibilidad de corrección de valor.
  - Respuesta: `{ id, valido, razon, decision, skipped, mecanismo: "RAG"|"WEB_SEARCH", fases: { rag: { ok, chunks?, razon_fallo? }, fetch: null }, valor_corregido?, valor_original?, unidad_corregida? }`.

### `/powerbi/evidencias`
- `GET /api/powerbi/evidencias?apikey=TOKEN` (o `Authorization: Bearer TOKEN`) — devuelve JSON plano de todas las rows. **No usa sesión**: autentica por token estático `POWERBI_TOKEN` (env). 503 si el token no está configurado, 401 si no coincide.

---

## 6. Lógica de negocio — estandarización de unidades

Implementada en `artifacts/api-server/src/routes/agent.ts` (funciones `conversionFactor()` y `computeStdValue()`). Se ejecuta en cada INSERT/UPDATE de evidencia desde el agente y tras VALIDATE.

Pasos:
1. Buscar `target = catalogUnitMap.get(id_data)` (la unidad objetivo del KPI según el catálogo). Si no hay → `{ unidad_estandarizada: null, valor_estandarizado: null }`.
2. Skip patterns: si la unidad cruda contiene `"no publicada"`, `"no aplica"`, `"cualitativo"`, `"compromiso"`, `"certificación"`, etc. → no convertible.
3. Tabla de conversión (extracto) — tener en cuenta minúsculas/espacios:
   - `M€`: `millones eur|millones de euros|m€|eur m|millones €` → ×1; `millones usd|m$` → ×0.93; `millones gbp` → ×1.17; `sek` → ×0.088; `dkk` → ×0.134; `eur bn|miles millones eur` → ×1000; `miles millones usd` → ×930; `miles de euros|miles eur` → ×0.001; `eur|euros|€` → ×1e-6.
   - `EUR`: `eur|euros|€` → ×1; `M€` → ×1e6; `miles eur` → ×1e3.
   - `Personas`: lista ~15 sinónimos (`personas`, `empleados`, `employees`, `trabajadores`, `efectivos`, `puestos`, `inserciones`, `plazas`, `nº`, `número`, `personas con discapacidad`, `personas atendidas`, …) → ×1.
   - `%`: `%|porcentaje|tasa|tasa crecimiento|% reducción|% crecimiento` → ×1.
   - `tCO2e`: `tco2e|tco2eq|tco2 eq|tco2` (sin `ktco2`, `mt co2`, `/`, `kwh`) → ×1; `ktco2e|kt co2` → ×1000; `mt co2e|mt co2|mton` → ×1e6. Intensidades (`gCO2/kWh`, `tCO2e/M€`) → no comparable.
   - `horas/persona`, `horas`, `veces`, `Seguidores`, `Puntos NPS`, `Puntos/100`: patrones específicos por target.
   - Catch-all: factor 1, convertible (para targets numéricos simples `Nº`, `Visitas`, `Posición`, `ratio`…).
4. `valor_estandarizado = round(valor * factor, 6)` si convertible, `null` si no.

---

## 7. Prompts de los agentes IA — textos canónicos

### Constantes compartidas (en `routes/agent.ts` y `AgentSearchModal.tsx`)

```
EFQM_CONTEXT = "CONTEXTO EFQM 2025 ILUNION = Grupo Social ONCE (hotelería, lavanderías, limpieza, contact center, consultoría, accesibilidad, sociosanitario, seguros, energía). Peers: Top Employers, EFQM, GPTW, ESG Leaders, o comparables del sector (ej. Meliá, ISS, Clece, Mapfre, Repsol, Sacyr). Fuentes: N1=EINF/memorias; N2=web corporativa; N3=certificaciones; N4=prensa; N5=estimaciones. Comparabilidad: Alta=misma def; Media=similar; Baja=distinto alcance; No comparable."
```

### System prompt de `/agent/gather`

```
{EFQM_CONTEXT}

Eres analista EFQM de benchmarking para ILUNION. Tu misión es encontrar el máximo número de evidencias numéricas verificables para el KPI solicitado, cubriendo empresas comparables y años 2022-2025.

{OUTPUT_SCHEMA}
```

donde `OUTPUT_SCHEMA` instruye devolver SOLO un bloque `<evidencias>[...]</evidencias>` con array de objetos cuyos campos son exactamente los del modelo `evidencias` excluyendo `id`, `created_at`, `decision_final`, `estado_auditoria`, `pilar_ilunion`, `encaje_indicador`, `tipo_compania`. `fuente_nivel ∈ {"Nivel 1","Nivel 2","Nivel 3","Nivel 4","Nivel 5"}`, `comparabilidad ∈ {"Alta","Media","Baja","No comparable"}`. Reglas: ≤ 12 evidencias por iteración pero nunca devolver bloque vacío, URLs reales, no repetir pares (empresa, año) ya en BBDD, cubrir 2022-2025.

### User prompt dinámico de `/agent/gather`

```
[Intento {i}/{N}: {existing}/{TARGET_TOTAL=20} evidencias. Amplía a más peers y años faltantes.]
KPI: "{indicador}" | Alcance: {alcance} | Sentido: {sentido}

EMPRESAS SUGERIDAS (no estricto — añade otras del mismo sector si las encuentras con datos): {entry.empresas_comparables.join(", ")}

BBDD — excluir estos pares empresa+año ya existentes:
COMPLETAS (omitir totalmente): EmpresaA, EmpresaB, … (+N más)
PARCIALES (solo faltan los años indicados): EmpresaC→2023,2025 | EmpresaD→2024 | …

OBJETIVO: Busca el valor de este KPI en informes anuales, memorias de sostenibilidad o EINF de empresas comparables para 2022-2025. Empieza por las sugeridas; si no tienen datos públicos, sustitúyelas por otras del mismo sector.

[⚠️ AVISO DE SATURACIÓN si aplica…]
[Instrucciones adicionales: {extra_instructions} si las hay]
```

### Prompt de `/agent/validate` (FASE 2 — web_search fallback)

```
Auditor EFQM. Verifica si el dato figura en la fuente y es coherente con el KPI.

{empresa} | {indicador} | {valor} {unidad} ({año})
Texto: "{texto_evidencia[:100]}"
URL: {url_validada}
Refs: {referencia: hasta 6 magnitudes de la misma KPI de otras empresas}

Busca en la URL o fuentes equivalentes. OK si el dato es coherente. DESCARTAR si contradice. REVISION MANUAL si inconcluyente.
JSON: {"resultado":"OK"|"DESCARTAR"|"REVISION MANUAL","razon":"≤20 palabras"}
```

### Prompts del RAG (`scripts/rag_service.py`)

System:
```
Eres auditor EFQM. Validas evidencias de benchmarking verificando si el valor declarado aparece o es coherente con los fragmentos recuperados de la fuente. Respondes ÚNICAMENTE con JSON válido, sin texto adicional.
```

User (compacto):
```
EVIDENCIA: {empresa} | {kpi} | {valor} {unidad} ({ano})
Texto: "{texto[:80]}"

FRAGMENTOS FUENTE:
[F1 score=…]: {chunk[:250]}
…

REFERENCIAS:
[Ref {empresa_peer} {ano}]: {chunk[:150]}
…

REGLAS:
1. Fragmentos contienen valor o texto coherente → OK
2. Fragmentos contienen valor DIFERENTE válido → OK + valor_corregido (solo número puro) + unidad_corregida
3. Fragmentos contradicen claramente → DESCARTAR
4. Sin fragmentos suficientes o ambiguo → REVISION MANUAL

JSON: {"resultado":"OK"|"DESCARTAR"|"REVISION MANUAL","razon":"≤20 palabras","valor_corregido":"solo número (omite si igual o no numérico)","unidad_corregida":"omite si no cambia"}
```

---

## 8. Variables de entorno

| Variable | Uso | Default / nota |
|---|---|---|
| `DATABASE_URL` | Connection string Postgres (Drizzle + drizzle-kit) | **Obligatoria** |
| `PORT` | Puerto del API Node y del Vite dev server | **Obligatoria** |
| `BASE_PATH` | Path base del frontend (Vite `base`) | **Obligatoria** (típicamente `/`) |
| `SESSION_SECRET` | Secreto express-session | Obligatoria en prod; en dev se usa fallback inseguro con warning |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Credenciales login | `admin` / `EFQM_2026` |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Base URL del proxy Anthropic (Replit AI Integrations) | Necesario en prod |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | API key del proxy | Necesario en prod |
| `OPENAI_API_KEY` | Embeddings (`text-embedding-3-large`) | Obligatoria en el RAG service |
| `POWERBI_TOKEN` | API key estática para `/api/powerbi/*` | Si no se configura → 503 en ese endpoint |
| `RAG_PORT` | Puerto del microservicio FastAPI | `8000` |
| `SEED_ON_STARTUP` | Si `"true"` y `count < 50`, carga `data/evidencias_seed.json` | Off por defecto |
| `NODE_ENV` | `development` / `production` | controla `secure` cookie, dev banners… |

---

## 9. Flujos de usuario clave

1. **Login** (Login.tsx): user/pass → `POST /api/auth/login` → cookie de sesión → `GET /api/auth/me` en cada montaje del `AuthProvider`.
2. **Listado y filtros** (Home + EvidenceFilters + EvidenceTable): un único `useListEvidencias(filters)` con `staleTime=30s`. Las opciones de filtros vienen de `useGetEvidenciasOptions()`.
3. **Alta / edición** (EvidenceFormModal): `react-hook-form` con schema Zod local (`codigo_indicador`, `empresa_comparable`, `fuente_tipo` requeridos), resto opcional/null. `useCreateEvidencia` / `useUpdateEvidencia` + invalidación de queries de evidencias y stats.
4. **Eliminar / marcar OK / DESCARTAR**: acciones inline en la tabla (AlertDialog para borrar).
5. **Descargar Excel**: en frontend, `GET /api/evidencias/download` + `xlsx.utils.json_to_sheet` + `xlsx.writeFile("evidencias_efqm_YYYY-MM-DD.xlsx")`.
6. **Buscar con IA** (AgentSearchModal):
   - Carga catálogo (`useGetAgentCatalog`).
   - El usuario puede buscar/filtrar el catálogo, seleccionar uno o varios KPIs y opcionalmente añadir `extra_instructions`.
   - Lanza `POST /api/agent/gather { id_data, extra_instructions }` con concurrencia 3 sobre los seleccionados. Muestra progreso (Progress bar), tokens y coste estimado por job y total.
   - Al terminar invalida `evidencias`, `stats`, `options`.
7. **Prevalidar Nuevas** (AgentValidateModal):
   - Lee `useListEvidencias({ decision_final: "NUEVA" })`.
   - Lanza `POST /api/agent/validate { id }` para cada una con concurrencia 6.
   - Muestra resultado por fila con badge del mecanismo (RAG con nº chunks / Web search / Error) y tres-icon (✓ verde, ✗ rojo, ⚠ ámbar). Soporta correcciones de valor (muestra original → corregido).

---

## 10. Configuración del frontend (detalles importantes)

- **shadcn/ui** `components.json` con `style: "new-york"`, `baseColor: "neutral"`, `cssVariables: true`, aliases `@/components`, `@/lib/utils`, `@/components/ui`, `@/hooks`.
- **Tailwind v4** se carga vía `@tailwindcss/vite` (sin `tailwind.config.js` clásico; los themes se definen como CSS variables en `src/index.css`).
- **wouter** con `base={import.meta.env.BASE_URL.replace(/\/$/, "")}`.
- **API base**: el cliente generado por orval llama a paths relativos `/api/…`. El backend está montado en el **mismo origen** del frontend (mismo dominio + path `/api`) gracias al proxy/router de Replit. `customFetch` añade `credentials: "include"` por defecto.
- **Fonts**: Inter (Google Fonts, preconnect en `index.html`), weights 400/500/600/700.
- **Cabecera**: bg `bg-primary text-primary-foreground` con logo `Building2`, título "ILUNION EFQM Evidencias" + subtítulo "Base de datos de benchmarking", y botones de acción a la derecha (`Plus`, `Download`, `ShieldCheck`, `Sparkles`, `LogOut`).
- **Colores de badges** (tabla):
  - Decisión: `OK` verde, `PREVALIDADO IA` emerald, `DESCARTAR` rojo, `REVISION MANUAL` naranja, `Pendiente` amarillo, `No aplica` gris.
  - tipo_compania: `ILUNION` rose, `ONCE` ámbar, `Externa` slate.
  - comparabilidad: `Alta` azul, `Media` índigo, `Baja` slate.

---

## 11. Comandos y workflows

```bash
# Instalación
pnpm install                              # respeta lockfile y catalog

# Typecheck completo
pnpm run typecheck                        # libs + artifacts + scripts

# Build (genera dist en cada artifact)
pnpm run build                            # typecheck + pnpm -r run build

# Regenerar cliente y schemas Zod desde openapi.yaml
pnpm --filter @workspace/api-spec run codegen
  # Internamente: orval -c orval.config.ts && parchea lib/api-zod/src/index.ts

# DB schema push (solo dev)
pnpm --filter @workspace/db run push      # drizzle-kit push --config ./drizzle.config.ts
pnpm --filter @workspace/db run push-force

# Backend en dev (Node)
pnpm --filter @workspace/api-server run dev
  # export NODE_ENV=development && pnpm run build && pnpm run start

# Frontend en dev (Vite)
pnpm --filter @workspace/efqm-evidencias run dev
  # vite --host 0.0.0.0

# RAG service (Python)
pip install -r scripts/requirements.txt
RAG_PORT=8000 python3 scripts/rag_service.py

# Arranque prod completo (start_prod.sh)
bash scripts/start_prod.sh
  # pip install + playwright install chromium + RAG en background + node dist/index.mjs
```

---

## 12. Decisiones / convenciones a respetar al reconstruir

1. **Monorepo pnpm con `catalog:`** para fijar versiones comunes (react 19.1.0, vite 7.x, tailwindcss 4.x, drizzle 0.45, zod 3.25). No usar `npm`/`yarn` (hay un `preinstall` que aborta).
2. **TypeScript estricto** pero con `noUnusedLocals: false` y `strictFunctionTypes: false` (compatibilidad con Drizzle).
3. **OpenAPI como fuente de verdad** del contrato API: cualquier cambio en `routes/*.ts` debe reflejarse en `openapi.yaml` y luego re-codegen para que el cliente React quede sincronizado. El `index.ts` de `api-zod` se patchea tras orval (un `export * from "./generated/api"` no se debe regenerar para evitar conflicto con tipos generados).
4. **Sesiones server-side**: el cliente NUNCA maneja tokens; `customFetch` envía cookies con `credentials: "include"`.
5. **El RAG service se invoca SIEMPRE por HTTP** (`http://localhost:${RAG_PORT}`), nunca como import Python. Node sólo conoce dos endpoints: `POST /ingest`, `POST /audit` (y opcionalmente `GET /health`, `POST /fetch`). Timeouts: 20 s para ingest, 300 s para audit.
6. **Idempotencia DB**: `runMigrations()` se llama en cada arranque y debe ser segura (CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS por cada columna). El `seed.ts` sólo inserta si `count < 50` y `SEED_ON_STARTUP === "true"`.
7. **Coste/tokens**: el agente `gather` debe trackear `usage.input_tokens` y `usage.output_tokens` y devolverlo en la respuesta. Coste estimado: `input * 1/1M + output * 5/1M` (Haiku 4.5).
8. **Cap de evidencias** del agente: `TARGET_TOTAL = 20` por KPI, hasta 5 intentos, 250 s de budget total, max_uses de `web_search` = 15. En `/validate` el cap es `max_uses=2` y `max_tokens=512`.
9. **Detección de saturación** del agente (umbral 80 % duplicados) y **stop con 2 intentos seguidos sin inserts**: importantes para evitar coste innecesario.
10. **Fast path RAG**: si el valor declarado (normalizado: sin espacios/puntos/comas) aparece literalmente en el top-chunk (score > 0.65), aprobar sin llamar al LLM. Ahorra ~80 % del coste de validación.
11. **`valor_corregido` solo si es un número puro** (regex `^-?\d+(\.\d+)?$`): el LLM puede devolver strings descriptivos que NO deben sobreescribir el valor original.
12. **No usar localStorage para auth**: confiar solo en cookie httpOnly + revalidación con `/auth/me`.
13. **CORS**: `origin: true` + `credentials: true` (mismo origen en prod, pero útil en dev cuando frontend y backend corren en puertos distintos).
14. **`trust proxy = 1`** en Express (necesario detrás del router de Replit / cualquier proxy TLS).

---

## 13. Prompt para Claude Code

Cuando arranques Claude Code en una carpeta vacía, pega este prompt como mensaje inicial:

> Reconstruye desde cero el monorepo **ILUNION EFQM Evidencias** descrito en este documento. Es un workspace **pnpm + TypeScript** con tres componentes:
>
> 1. **Backend** `artifacts/api-server` — Express 5 + Drizzle + Postgres + Anthropic SDK. Implementa el modelo `evidencias`, el CRUD, autenticación por sesión, el endpoint Power BI, y los dos agentes IA (`/agent/gather` y `/agent/validate`) tal cual están descritos en §5, §6 y §7. Bundling con esbuild → `dist/index.mjs`.
> 2. **Frontend** `artifacts/efqm-evidencias` — React 19 + Vite + shadcn/ui (style new-york) + Tailwind v4 + wouter + react-query. Login, Home con Stats + Filtros + Tabla, modales de alta/edición, agente de búsqueda y agente de prevalidación. Cliente HTTP generado por **Orval** desde `lib/api-spec/openapi.yaml` (re-codegen como parte del workflow).
> 3. **Microservicio RAG** `scripts/rag_service.py` — FastAPI + LangChain + OpenAI embeddings (`text-embedding-3-large`) + in-memory store con numpy cosine sim + persistencia pickle, y Anthropic Haiku como auditor. Endpoints `/health`, `/fetch`, `/ingest`, `/audit`.
>
> Sigue exactamente la **estructura de carpetas** (§3), el **modelo de datos** (§4), la **API** (§5), la **lógica de estandarización de unidades** (§6), los **prompts canónicos** de los agentes (§7), las **variables de entorno** (§8) y las **decisiones de diseño** (§12). Usa el **catálogo de KPIs** descrito en §4 como referencia para la forma de `data/bdd_indicadores_catalog.json` (pero deja un placeholder con 1-2 entradas de ejemplo si no tienes el original).
>
> Empieza por:
> 1. Crear `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `.npmrc`, `.gitignore`.
> 2. Implementar `lib/db` (schema + drizzle config + pool).
> 3. Implementar `lib/api-spec/openapi.yaml` y configurar Orval (`lib/api-spec/orval.config.ts`) con los dos outputs (`react-query` + `zod`).
> 4. Implementar `lib/api-zod` y `lib/api-client-react` (con `custom-fetch.ts`).
> 5. Implementar el backend `artifacts/api-server` (rutas + middlewares + seed + build).
> 6. Implementar el frontend `artifacts/efqm-evidencias` (App + páginas + componentes + UI shadcn).
> 7. Implementar `scripts/rag_service.py` + `requirements.txt` + `start_prod.sh`.
> 8. Generar el cliente Orval (`pnpm --filter @workspace/api-spec run codegen`).
> 9. Verificar `pnpm run typecheck` y `pnpm run build`.
>
> Antes de cada paso comprueba el typecheck del subworkspace correspondiente. Si una librería no existe en el ecosistema de Orval/Drizzle/shadcn, **pregunta antes de inventar** en lugar de generar código incorrecto.

---

*Documento generado automáticamente escaneando el repositorio en `C:\Users\rjcol\Desktop\Codigo\Asset-Manager` (rama `main`).*
