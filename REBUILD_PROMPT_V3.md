# Prompt de reconstrucción V3 — Asset Manager (self-hosted, ingesta IA)

> **Cómo usar este documento**
>
> Este es el **paso 3** del rediseño. Es un **delta sobre `REBUILD_PROMPT_V2.md`** (no lo sustituye: todo lo que V2 deja en pie sigue vigente). Cambia tres cosas críticas:
>
> 1. **Ingesta dual de Excel**: el catálogo de KPIs se parsea con **IA** (formato libre); las evidencias usan un **schema fijo** con plantilla descargable y validación estricta.
> 2. **Despliegue self-hosted** en servidor Ubuntu LTS personal con **Docker Compose**, **Nginx** y **Cloudflare** como DNS proxy con TLS terminado en el origen. Dominio: `https://rcoloma.dev/evidencias`.
> 3. **Subpath `/evidencias`** en producción: ya no se sirve en raíz, sino bajo un path prefix. Esto afecta a Vite (`base`), a Express (`app.use("/evidencias/api", …)`), al cliente Orval (`baseUrl`) y a wouter (`<Router base>`).
>
> Si vas a aplicar las V1+V2+V3 en orden, **lee primero V2** para el marco multi-proyecto/multi-usuario y luego este documento.

---

## 1. Resumen ejecutivo de cambios respecto a V2

| Tema | V2 | V3 |
|---|---|---|
| Ingesta Excel de catálogo | Parser determinístico con heurística de cabeceras | **Parser IA** (Claude Haiku) que descubre la estructura del Excel arbitrario y propone un mapeo columna→campo con confianza. El usuario revisa y aprueba el mapeo. El mapeo aprobado se guarda y se reutiliza determinísticamente en futuras subidas con el mismo formato |
| Ingesta Excel de evidencias | No existe (se importaban vía agente IA o creación manual) | **Schema fijo y documentado**, plantilla `.xlsx` descargable, validación Zod estricta, upsert determinístico por clave natural `(project_id, kpi_external_code, empresa_comparable, ano)` |
| Despliegue | Replit autoscale | **Servidor Ubuntu LTS** propio + **Docker Compose** + **Nginx** en el host + **Cloudflare DNS proxy** |
| TLS | Replit gestionado | **Cloudflare Origin Certificate** instalado en Nginx + opcional Authenticated Origin Pulls |
| Dominio / paths | Servido en raíz | **`https://rcoloma.dev/evidencias`** — subpath fijo |
| Variables sensibles | `process.env` | **`.env` en disco + Docker Compose `env_file`**, fuera del repo (`.gitignore`), permisos 600 |
| Backups | Replit snapshots | **`pg_dump` programado** vía cron en el host, retención local + opcional sync a Cloudflare R2 |
| Logs | Console / Replit | **`docker logs` + `journalctl`** + opcional Loki/Grafana en otro stack |
| Deploy | `git push` en Replit | **SSH + `git pull` + `docker compose up -d`** (manual o vía GitHub Actions con `appleboy/ssh-action`) |
| Updates de dependencias | Auto en Replit | **Renovate bot** en GitHub (opcional) + revisión manual |

---

## 2. Pipeline de ingesta de catálogo de KPIs con IA

### Por qué con IA

Cada cliente (proyecto) trae su Excel de KPIs en un formato distinto: cabeceras en español/inglés/mezcla, columnas en órdenes arbitrarios, jerarquías visuales (filas combinadas, secciones), unidades inconsistentes (`M€`, `mill euros`, `millones de €`), columnas extra sin equivalente directo, hojas con datos relevantes en cualquier posición. Una heurística de regex sobre cabeceras falla en ~30 % de los casos reales.

La solución es **dejar que un LLM lea el Excel y proponga el mapeo**, pero el mapeo en sí queda explícito y editable: la IA no inventa datos, solo identifica estructura.

### Flujo completo

```
┌──────────────────────────────────────────────────────────┐
│ 1. Upload XLSX  (POST .../kpi-ingestions)                 │
│    multer, máx 10 MB, sha256                              │
└──────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│ 2. Parser estructural (lib/excel/structuralParser.ts)    │
│    Lee con SheetJS TODAS las hojas                       │
│    Para cada hoja extrae:                                │
│      - Nombre de la hoja                                 │
│      - Una "muestra estructural" = primeras 30 filas     │
│        × hasta 30 columnas, normalizada a strings        │
│      - Total de filas y columnas                         │
│      - Hash de la estructura (header signature)           │
└──────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│ 3. ¿Existe schema_template guardado para este proyecto    │
│    con el mismo header signature?                         │
│      SÍ → saltar al paso 6 (parser determinístico)        │
│      NO → paso 4 (descubrimiento con IA)                  │
└──────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│ 4. Llamada a Claude Haiku (lib/agents/kpiSchemaDiscoverer)│
│    Input: muestras de cada hoja + descripción del proyecto│
│    System prompt: "Eres analista de datos. Identifica     │
│      qué hoja contiene el catálogo de KPIs y mapea sus    │
│      columnas a un schema canónico. Responde JSON."       │
│    Output esperado (Zod-validated):                       │
│      {                                                    │
│        sheet: "KPIs 2026",                                │
│        header_row: 3,                                     │
│        column_mapping: {                                  │
│          external_code:   { source_col: "B", header: "Cod. KPI", confidence: 0.95 },│
│          name:            { source_col: "C", header: "Indicador", confidence: 0.98 },│
│          standard_unit:   { source_col: "F", header: "Unidad", confidence: 0.85 },│
│          comparable_companies: { source_col: "H", header: "Peers (separados por ;)", confidence: 0.7 },│
│          ...                                              │
│        },                                                 │
│        skip_rows: [4, 5],   // filas vacías o cabeceras secundarias│
│        notes: "La columna G tiene la unidad original; mapeada a `unit_original` en extra{}"│
│      }                                                    │
└──────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│ 5. Frontend: vista "Revisar mapeo"                        │
│    Tabla con dos columnas: campo canónico ↔ columna Excel │
│    El usuario puede:                                      │
│      - Cambiar la columna asignada (dropdown)             │
│      - Descartar un mapeo (skip)                          │
│      - Añadir mapeos a campos extra{}                     │
│      - Cambiar header_row                                 │
│    Confirma → guarda el mapeo en kpi_schema_templates     │
└──────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│ 6. Parser determinístico (lib/excel/deterministicParser)  │
│    Con el mapping confirmado:                             │
│      Para cada fila ≥ header_row + 1:                     │
│        - Salta si está en skip_rows                       │
│        - Lee según el mapping                             │
│        - Convierte tipos (string, number, array de peers) │
│        - Valida con Zod (external_code y name requeridos) │
│        - Acumula errores por fila                         │
└──────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│ 7. Diff vs catálogo actual (igual que V2 §5)              │
│    new / updated / removed / unchanged + conflictos       │
└──────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│ 8. Preview en frontend + commit transaccional             │
│    (Mismo flujo que V2)                                   │
└──────────────────────────────────────────────────────────┘
```

### Nueva tabla `kpi_schema_templates`

Persistir los mapeos aprobados para evitar volver a llamar al LLM cuando el formato se repite.

```ts
pgTable("kpi_schema_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  project_id: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  header_signature: text("header_signature").notNull(),   // sha256 de headers concatenados de la hoja elegida
  sheet_name: text("sheet_name").notNull(),
  header_row: integer("header_row").notNull(),
  column_mapping: jsonb("column_mapping").notNull(),       // ver §2.4
  skip_rows: integer("skip_rows").array().notNull().default(sql`'{}'::int[]`),
  created_by: uuid("created_by").notNull().references(() => users.id),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  last_used_at: timestamp("last_used_at", { withTimezone: true }),
  uses_count: integer("uses_count").notNull().default(0),
}, t => ({
  uniqSig: uniqueIndex("kpi_schema_templates_proj_sig_idx").on(t.project_id, t.header_signature),
}));
```

### Prompts del descubridor

System prompt:
```
Eres analista de datos especializado en frameworks de indicadores (EFQM, GRI, ESG, KPI corporativos).
Recibes una muestra de las primeras filas de cada hoja de un Excel y la descripción del proyecto.
Debes:
  1. Identificar qué hoja contiene el catálogo de KPIs (no datos puntuales ni resúmenes).
  2. Detectar la fila de cabeceras y filas a saltar (totales, secciones vacías).
  3. Mapear las columnas a este schema canónico:
       external_code       (obligatorio — código único del KPI)
       name                (obligatorio — nombre del indicador)
       scope               (opcional — alcance: "ILUNION", "Global", "España"…)
       responsible_area    (opcional — área responsable)
       direction           (opcional — "ASCENDENTE" / "DESCENDENTE" / "NEUTRO")
       standard_unit       (opcional — unidad estándar: "M€", "%", "Personas", "tCO2e"…)
       comparable_companies (opcional — lista de empresas peer; soporta separadores ";" o ",")
       category            (opcional — categoría EFQM/GRI/etc.)
       description         (opcional — descripción larga)
  4. Cualquier otra columna útil → mapearla a `extra.<nombre_normalizado>`.
  5. Asignar `confidence` (0-1) a cada mapping.

Respondes SÓLO con un JSON válido conforme al schema indicado. Sin texto adicional. Sin comentarios. Si no estás seguro de un mapeo, omítelo (no inventes columnas inexistentes).
```

User prompt:
```
PROYECTO: "{project.name}"
FRAMEWORK: {project.framework}
DESCRIPCIÓN: {project.description}

HOJAS DEL EXCEL:
  Hoja "{sheet1.name}" ({sheet1.rows} filas × {sheet1.cols} columnas):
  Primeras 30 filas (formato CSV con índice de columna A/B/C…):

      | A | B | C | D | E | F | G | H |
    1 | …
    2 | …
    …

  Hoja "{sheet2.name}" …

Devuelve un JSON con:
{
  "sheet": "<nombre exacto de la hoja elegida>",
  "header_row": <número 1-indexed>,
  "skip_rows": [<números de filas a ignorar>],
  "column_mapping": {
    "<campo canónico>": {
      "source_col": "<letra de columna>",
      "header": "<texto exacto de la cabecera>",
      "confidence": <0..1>
    },
    ...
  },
  "notes": "<observaciones cortas>"
}
```

Modelo: `claude-haiku-4-5`, `max_tokens=2048`, `temperature=0`. Coste estimado < $0.005 por descubrimiento.

### Validación del output del LLM

El service `kpiSchemaDiscoverer.ts`:
1. Parsea la respuesta con Zod `DiscoveredSchema`.
2. Verifica que `sheet` existe en el workbook.
3. Verifica que `header_row` está en rango.
4. Para cada `column_mapping`, verifica que `source_col` (letra) existe en la hoja y que la cabecera en esa columna coincide aproximadamente (Levenshtein distance ≤ 2) con el `header` reportado.
5. Si **algún mapping con `confidence > 0.6` falla la verificación** → reintenta una vez con feedback. Si vuelve a fallar → devuelve el mapeo con flags para que el frontend marque las filas conflictivas y obligue al usuario a revisarlas.

### Reutilización del template

Cuando un usuario sube otro Excel:
1. Se calcula `header_signature = sha256(headers normalizados de cada hoja)`.
2. Si coincide con un `kpi_schema_templates` existente para el proyecto, se aplica directamente y se incrementa `uses_count`.
3. Si no coincide → descubrimiento con IA + nuevo template.

Esto significa que **el usuario sólo paga el coste de la IA una vez por formato**.

---

## 3. Pipeline de ingesta de Excel de evidencias (formato fijo)

### Schema canónico

Una sola hoja llamada exactamente `evidencias`. Cabeceras en la fila 1, datos desde la fila 2. **Orden y nombres de columna fijos** (sin tolerancia a variaciones):

| # | Columna | Tipo | Obligatorio | Notas |
|---|---|---|---|---|
| A | `kpi_external_code` | string | ✓ | Debe existir en el catálogo del proyecto. Si no, fila → error. |
| B | `empresa_comparable` | string | ✓ | Máx 200 chars. |
| C | `ano` | integer | ✓ | 2000-2099. |
| D | `entidad_fuente` | string |  | Empresa/organismo de la fuente. |
| E | `fuente_nivel` | enum |  | `Nivel 1`–`Nivel 5`. |
| F | `fuente_tipo` | string | ✓ | EINF / Web corporativa / Certificación / Prensa / Estimación / Otro. |
| G | `fuente_titulo` | string |  |  |
| H | `url_validada` | string (URL) |  | http(s):// |
| I | `ubicacion_fuente` | string |  | `p. 34`, `tabla 12`, etc. |
| J | `texto_evidencia` | string |  | Cita textual breve, máx 1000 chars. |
| K | `valor_reportado` | number |  | Decimal, separador `.` (Excel locale-independent). |
| L | `unidad` | string |  | Unidad tal cual aparece en la fuente. |
| M | `comparabilidad` | enum |  | `Alta` / `Media` / `Baja` / `No comparable`. |
| N | `observacion_metodologica` | string |  |  |
| O | `decision_final` | enum |  | `OK` / `PREVALIDADO IA` / `DESCARTAR` / `REVISION MANUAL` / `NUEVA` / `Pendiente` / `No aplica`. Default `NUEVA` si vacío. |
| P | `definicion_referencia` | string |  |  |
| Q | `unidad_base_referencia` | string |  |  |
| R | `indicador_fuente` | string |  | Cómo lo llamaba la fuente. |
| S | `encaje_indicador` | string |  |  |

El XLSX **debe** tener exactamente esas cabeceras en la fila 1 con esos nombres. Si falta una columna obligatoria, se rechaza con 422.

### Plantilla descargable

Endpoint `GET /api/projects/:id/evidencias/template.xlsx`:
- Hoja `evidencias` con cabeceras en formato bold + freeze.
- Hoja `instrucciones` con tipos, valores permitidos y ejemplos.
- Hoja `kpis` con el catálogo del proyecto (read-only) para que el usuario consulte los `kpi_external_code`.
- Hoja `enums` con listas para validación nativa de Excel:
  - `fuente_nivel`: Nivel 1, Nivel 2, …
  - `comparabilidad`: Alta, Media, Baja, No comparable
  - `decision_final`: NUEVA, OK, PREVALIDADO IA, …
- Data validation aplicada en las columnas correspondientes.
- Generada con `exceljs` (más control que SheetJS para data validation y estilos).

### Upsert determinístico

Clave natural de upsert: **`(project_id, kpi_external_code, empresa_comparable, ano)`**.

```ts
// repositories/evidencias.repo.ts
async function upsertFromExcel(
  tx: Tx,
  projectId: string,
  rows: ParsedEvidenceRow[],
) {
  // Match contra kpis por external_code para resolver kpi_id
  const kpiMap = await getKpiMapByExternalCode(tx, projectId);

  const operations = rows.map(row => {
    const kpiId = kpiMap.get(row.kpi_external_code);
    if (!kpiId) return { row, kind: "error", reason: "KPI_NOT_FOUND" } as const;
    return { row, kind: "ok", kpiId } as const;
  });

  // Lookup existentes por clave natural
  const validOps = operations.filter(o => o.kind === "ok");
  const existing = await findByNaturalKeys(tx, projectId, validOps.map(o => ({
    kpi_id: o.kpiId, empresa: o.row.empresa_comparable, ano: o.row.ano,
  })));
  const existingMap = new Map(existing.map(e => [
    `${e.kpi_id}|${e.empresa_comparable}|${e.ano}`, e,
  ]));

  let added = 0, updated = 0, unchanged = 0;
  for (const op of validOps) {
    const key = `${op.kpiId}|${op.row.empresa_comparable}|${op.row.ano}`;
    const existingRow = existingMap.get(key);
    if (!existingRow) {
      await insertEvidencia(tx, { project_id: projectId, kpi_id: op.kpiId, ...op.row });
      added++;
    } else if (rowDiffers(existingRow, op.row)) {
      await updateEvidencia(tx, existingRow.id, { ...op.row });
      updated++;
    } else {
      unchanged++;
    }
  }
  return { added, updated, unchanged, errors: operations.filter(o => o.kind === "error") };
}
```

### Modo "empezar de cero"

Endpoint `POST /api/projects/:id/evidencias/import` con opciones:
```ts
z.object({
  mode: z.enum(["upsert", "replace"]),  // replace = TRUNCATE evidencias del proyecto antes de insertar
  dry_run: z.boolean().default(false),  // si true, solo devuelve diff sin tocar BBDD
})
```

`mode = "replace"` requiere confirmación adicional en el frontend con texto del nombre del proyecto (similar a borrar repos en GitHub) — está pensado para casos puntuales de re-bootstrap.

### Diff preview de evidencias

Igual que para KPIs pero con tabla simplificada (Nuevos / Modificados / Errores) — no hay categoría "Eliminados" porque el upsert no borra (sólo `replace` lo hace, y eso es destructivo explícitamente).

### Endpoints

```
GET    /api/projects/:id/evidencias/template.xlsx     (viewer)
POST   /api/projects/:id/evidencias/import            (editor)  multipart/form-data file
GET    /api/projects/:id/evidencias/imports/:runId    (viewer)  detalle del import
POST   /api/projects/:id/evidencias/imports/:runId/commit (editor) {dry_run?}
DELETE /api/projects/:id/evidencias/imports/:runId    (editor)
```

Tabla `evidencia_imports` análoga a `kpi_ingestion_runs`.

### Export simétrico

`GET /api/projects/:id/evidencias/download.xlsx` devuelve el mismo schema fijo + hoja `kpis` (catálogo) + hoja `metadata`. El usuario puede descargar → editar en local → re-subir → upsert.

---

## 4. Infraestructura — Docker Compose en Ubuntu LTS

### Inventario del stack en el server

```
ubuntu-lts (rcoloma.dev)
│
├── docker (apt)
│   └── docker-compose.yml (en ~/asset-manager/)
│       ├── service: postgres        (postgres:16-alpine, volume persistente)
│       ├── service: rag             (python:3.11-slim build local con scripts/)
│       ├── service: api             (node:24-alpine build local con artifacts/api-server)
│       ├── service: worker          (mismo image que api, comando = workers)
│       └── service: caddy/nginx     (opcional — alternativa al Nginx del host)
│
├── nginx (apt, en host)
│   └── /etc/nginx/sites-available/rcoloma.dev.conf
│
├── cloudflared (opcional, si en el futuro se quisiera Tunnel)
│
├── certs Cloudflare Origin
│   ├── /etc/ssl/cloudflare/rcoloma.dev.pem
│   └── /etc/ssl/cloudflare/rcoloma.dev.key
│
├── backups
│   └── /var/backups/postgres/   (cron diario)
│
└── usuario `rodrigo` (no root) con sudo, ssh-key only
```

### Estructura del repo añadida en V3

```
Asset-Manager/
├── deploy/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml          # overrides para prod (restart policy, etc.)
│   ├── .env.example                     # plantilla de envs
│   ├── nginx/
│   │   └── rcoloma.dev.conf             # vhost completo para copiar a /etc/nginx
│   ├── postgres/
│   │   └── init.sql                     # CREATE DATABASE assetmanager + extensions
│   ├── scripts/
│   │   ├── backup.sh                    # pg_dump + rotación
│   │   ├── restore.sh                   # restore desde un dump
│   │   ├── deploy.sh                    # git pull + docker compose build + up -d + migrate
│   │   └── healthcheck.sh               # curl a /healthz + check de cada servicio
│   └── systemd/
│       ├── asset-manager.service        # wrapper de docker compose (opcional)
│       └── asset-manager-backup.timer   # backup diario
│
├── artifacts/api-server/
│   └── Dockerfile                       # multi-stage build (deps + build + runtime alpine)
│
├── artifacts/web/
│   └── Dockerfile                       # static build con Nginx alpine para servir /dist
│       # alternativa: que Nginx del host sirva /dist directamente
│
└── scripts/
    └── Dockerfile                       # python:3.11-slim + requirements.txt + playwright chromium
```

### `deploy/docker-compose.yml`

```yaml
name: asset-manager

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: assetmanager
      POSTGRES_USER: assetmanager
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    secrets:
      - postgres_password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U assetmanager -d assetmanager"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [internal]

  rag:
    build:
      context: ..
      dockerfile: scripts/Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      RAG_PORT: 8000
    volumes:
      - rag_store:/data/rag_store     # persistencia de pickle por proyecto
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks: [internal]

  api:
    build:
      context: ..
      dockerfile: artifacts/api-server/Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgres://assetmanager:${POSTGRES_PASSWORD}@postgres:5432/assetmanager
      RAG_URL: http://rag:8000
      PORT: 8080
      BASE_PATH: /evidencias
      ROLE: api          # leído por src/index.ts para decidir si arranca workers también
    depends_on:
      postgres: { condition: service_healthy }
      rag:      { condition: service_started }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/evidencias/api/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks: [internal, edge]

  worker:
    build:
      context: ..
      dockerfile: artifacts/api-server/Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgres://assetmanager:${POSTGRES_PASSWORD}@postgres:5432/assetmanager
      RAG_URL: http://rag:8000
      ROLE: worker
    depends_on:
      postgres: { condition: service_healthy }
      rag:      { condition: service_started }
    networks: [internal]

  web:
    # Sirve los archivos estáticos del build de Vite.
    # Alternativa: que el Nginx del host sirva directamente artifacts/web/dist
    image: nginx:alpine
    restart: unless-stopped
    volumes:
      - ../artifacts/web/dist:/usr/share/nginx/html:ro
      - ./nginx/web.conf:/etc/nginx/conf.d/default.conf:ro
    networks: [edge]

networks:
  internal:
    driver: bridge
  edge:
    driver: bridge

volumes:
  postgres_data:
  rag_store:

secrets:
  postgres_password:
    file: ./secrets/postgres_password.txt
```

Notas:
- Postgres NO expone puerto al host (sólo accesible desde la red `internal`). El usuario hace túneles SSH (`ssh -L 5432:localhost:5432`) cuando necesite acceder con un cliente.
- `api` arranca con `ROLE=api` y `worker` con `ROLE=worker`: comparten image, el `index.ts` decide qué inicializar según el env. Permite escalar workers independientemente.
- Build context relativo a `..` para que el Dockerfile pueda acceder a otros packages del monorepo.
- `rag_store` en volumen Docker para persistir embeddings entre reinicios.

### `artifacts/api-server/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY artifacts/api-server/package.json     artifacts/api-server/
COPY lib/db/package.json                   lib/db/
COPY lib/api-zod/package.json              lib/api-zod/
COPY lib/api-spec/package.json             lib/api-spec/
COPY lib/api-client-react/package.json     lib/api-client-react/
COPY scripts/package.json                  scripts/
RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..."

FROM deps AS build
COPY . .
RUN pnpm --filter @workspace/api-server run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
USER node
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
```

### `scripts/Dockerfile` (RAG service)

```dockerfile
FROM python:3.11-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
      libgbm1 libnss3 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
      libgtk-3-0 libxkbcommon0 libdrm2 \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY scripts/requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt

# Playwright Chromium para crawl4ai
RUN pip install --no-cache-dir playwright && playwright install --with-deps chromium

COPY scripts/ ./

ENV RAG_PORT=8000
EXPOSE 8000

CMD ["python3", "rag_service.py"]
```

### Nginx vhost en el host (`/etc/nginx/sites-available/rcoloma.dev.conf`)

```nginx
# Cloudflare Origin Cert + reverse proxy a Docker
upstream am_web {
    server 127.0.0.1:8081;   # contenedor "web" expuesto en 127.0.0.1:8081 (definido en compose como ports)
    keepalive 16;
}
upstream am_api {
    server 127.0.0.1:8080;   # contenedor "api"
    keepalive 16;
}

server {
    listen 80;
    server_name rcoloma.dev;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name rcoloma.dev;

    ssl_certificate     /etc/ssl/cloudflare/rcoloma.dev.pem;
    ssl_certificate_key /etc/ssl/cloudflare/rcoloma.dev.key;

    # Authenticated Origin Pulls (opcional, recomendado)
    # ssl_client_certificate /etc/ssl/cloudflare/authenticated_origin_pull_ca.pem;
    # ssl_verify_client on;

    # HSTS — sólo activarlo cuando estés seguro
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Tamaño máximo de upload (Excel hasta 10 MB)
    client_max_body_size 15M;

    # Frontend estático bajo /evidencias
    location /evidencias/ {
        proxy_pass http://am_web/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # API
    location /evidencias/api/ {
        proxy_pass http://am_api/evidencias/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";

        # Streaming para SSE de jobs
        proxy_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # Optional: redirigir / a /evidencias/
    location = / {
        return 302 /evidencias/;
    }

    # Logs específicos del proyecto
    access_log /var/log/nginx/rcoloma.dev.access.log combined;
    error_log  /var/log/nginx/rcoloma.dev.error.log warn;
}
```

Y los contenedores `api` y `web` exponen puerto al loopback únicamente en `docker-compose.prod.yml`:

```yaml
services:
  api:
    ports:
      - "127.0.0.1:8080:8080"
  web:
    ports:
      - "127.0.0.1:8081:80"
```

### Cloudflare DNS proxy

1. Panel Cloudflare → DNS → añadir A record `rcoloma.dev → <IP_PUBLICA_SERVER>`, **Proxy ON (naranja)**.
2. SSL/TLS → modo **Full (strict)**.
3. SSL/TLS → Origin Server → Create Certificate → 15 años, RSA 2048. Descargar `.pem` y `.key` y copiar a `/etc/ssl/cloudflare/` (permisos 600).
4. (Opcional) SSL/TLS → Origin Server → Authenticated Origin Pulls → Enabled. Descargar el CA cert y descomentar las líneas correspondientes en Nginx.
5. Security → Bots → Bot Fight Mode ON.
6. Rules → Page Rules → opcional: cache estático en `*rcoloma.dev/evidencias/assets/*` (Edge Cache TTL: 1 month).

### Subpath `/evidencias` — implicaciones en el código

**Frontend (Vite)**
```ts
// vite.config.ts
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",   // en prod: /evidencias/
  // …
});
```

**Frontend (wouter)**
```tsx
<WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
  …
</WouterRouter>
```

**Frontend (cliente Orval)**
```ts
// lib/api-client-react/src/init.ts
import { setBaseUrl } from "./custom-fetch";

setBaseUrl(import.meta.env.BASE_URL.replace(/\/$/, "") + "/api");
// resultado en prod: /evidencias/api
```

**Backend (Express)**
```ts
// app.ts
const basePath = process.env.BASE_PATH ?? "";  // "/evidencias" en prod
app.use(`${basePath}/api`, router);
app.use(`${basePath}/api/auth`, authRouter);
```

**Cookies**
```ts
app.use(session({
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: true,             // siempre true detrás de Cloudflare
    path: process.env.BASE_PATH ?? "/",   // /evidencias
    domain: "rcoloma.dev",
  },
  // …
}));
```

`trust proxy = 1` (ya estaba en V1).

---

## 5. Variables de entorno en deploy (`deploy/.env`)

Fichero no versionado (`.gitignore`), permisos 600:

```bash
# Servidor
PORT=8080
BASE_PATH=/evidencias
NODE_ENV=production
LOG_LEVEL=info

# DB (POSTGRES_PASSWORD también está en secrets/postgres_password.txt para el contenedor postgres)
POSTGRES_PASSWORD=********
DATABASE_URL=postgres://assetmanager:${POSTGRES_PASSWORD}@postgres:5432/assetmanager

# Sesiones / argon2
SESSION_SECRET=********
ARGON2_SECRET=********

# Anthropic
AI_INTEGRATIONS_ANTHROPIC_BASE_URL=https://api.anthropic.com
AI_INTEGRATIONS_ANTHROPIC_API_KEY=sk-ant-…

# OpenAI (embeddings)
OPENAI_API_KEY=sk-…

# RAG service
RAG_URL=http://rag:8000
RAG_PORT=8000

# Jobs
JOB_CONCURRENCY_GATHER=3
JOB_CONCURRENCY_VALIDATE=6

# Email (opcional)
EMAIL_PROVIDER=resend
EMAIL_FROM=evidencias@rcoloma.dev
RESEND_API_KEY=re_…

# Storage
STORAGE_DIR=/data/uploads
```

---

## 6. Backups

### Script `deploy/scripts/backup.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/postgres"
RETENTION_DAYS=14
STAMP=$(date -u +"%Y%m%dT%H%M%SZ")
FILE="$BACKUP_DIR/assetmanager_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

docker compose -f /home/rodrigo/asset-manager/deploy/docker-compose.yml \
  exec -T postgres pg_dump -U assetmanager assetmanager \
  | gzip -9 > "$FILE"

# Rotación
find "$BACKUP_DIR" -name "assetmanager_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete

echo "Backup completado: $FILE ($(du -h "$FILE" | cut -f1))"

# Sync opcional a R2
# rclone copy "$FILE" r2:asset-manager-backups/postgres/
```

### Timer systemd `deploy/systemd/asset-manager-backup.timer`

```ini
[Unit]
Description=Backup diario de Asset Manager Postgres

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

Y la unidad asociada:
```ini
[Unit]
Description=Postgres dump
After=docker.service

[Service]
Type=oneshot
User=rodrigo
ExecStart=/home/rodrigo/asset-manager/deploy/scripts/backup.sh
```

---

## 7. Deploy

### Workflow manual (estándar)

```bash
# Local: push a main
git push origin main

# En el server (vía SSH)
cd ~/asset-manager
git pull --rebase --autostash
./deploy/scripts/deploy.sh
```

Donde `deploy.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

# 1. Build (en el server, no en local — más reproducible)
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml build api worker rag web

# 2. DB migrations (no destructivas — drizzle push usa IF NOT EXISTS)
docker compose -f deploy/docker-compose.yml run --rm api \
  node --enable-source-maps dist/migrate.mjs

# 3. Restart rolling (con healthcheck)
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml up -d --remove-orphans

# 4. Cleanup
docker image prune -f

# 5. Healthcheck post-deploy
sleep 5
./deploy/scripts/healthcheck.sh

echo "Deploy completado: $(git rev-parse --short HEAD)"
```

### CI/CD opcional con GitHub Actions

`.github/workflows/deploy.yml`:
```yaml
name: Deploy to rcoloma.dev
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: SSH and deploy
        uses: appleboy/ssh-action@v1
        with:
          host: rcoloma.dev
          username: rodrigo
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd ~/asset-manager
            git fetch --all
            git reset --hard origin/main
            ./deploy/scripts/deploy.sh
```

Con `SSH_KEY` añadida en `~/.ssh/authorized_keys` del usuario `rodrigo` (sólo `command="cd ~/asset-manager && ./deploy/scripts/deploy.sh",no-agent-forwarding,no-port-forwarding`).

---

## 8. Hardening del server (Ubuntu LTS)

Pasos mínimos al provisionar el server:

```bash
# Usuario sin root
sudo adduser rodrigo
sudo usermod -aG sudo,docker rodrigo

# SSH key only
sudo sed -i 's/^#?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# Firewall: solo 22, 80, 443 al exterior
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Cloudflare-only para 80/443 (opcional, más estricto)
# Solo permitir conexiones desde IPs de Cloudflare:
# https://www.cloudflare.com/ips/  →  for ip in $(cat ips); do ufw allow from $ip to any port 443; done
# Y revocar el "allow 443/tcp" general.

# Fail2ban
sudo apt-get install -y fail2ban

# Automatic security updates
sudo dpkg-reconfigure --priority=low unattended-upgrades

# Instalar Docker (siguiendo docs oficiales)
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker

# Instalar Nginx
sudo apt-get install -y nginx
sudo systemctl enable --now nginx
```

---

## 9. Cambios en el frontend para el subpath

### `vite.config.ts`
```ts
const basePath = process.env.BASE_PATH ?? "/";
if (!basePath.endsWith("/")) {
  throw new Error("BASE_PATH must end with /");
}
export default defineConfig({
  base: basePath,
  // …
});
```

Build local: `BASE_PATH=/ pnpm run build`
Build prod: `BASE_PATH=/evidencias/ pnpm run build`

### `App.tsx`
```tsx
<WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
```

### Cliente Orval (`lib/api-client-react/src/init.ts`)
```ts
import { setBaseUrl } from "./custom-fetch";
const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
setBaseUrl(apiBase);
```

### Cookies
La sesión debe vivir bajo `/evidencias`. Express:
```ts
cookie: {
  path: basePath || "/",
  secure: true,
  sameSite: "lax",
  httpOnly: true,
  domain: process.env.COOKIE_DOMAIN, // "rcoloma.dev"
},
```

### Power BI
URL pública:
```
https://rcoloma.dev/evidencias/api/powerbi/<projectSlug>/evidencias?apikey=...
```

---

## 10. Tests E2E del despliegue (smoke)

`deploy/scripts/healthcheck.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-https://rcoloma.dev/evidencias}"

echo "→ Health API"
curl -fsS "$BASE/api/healthz" | tee /dev/stderr | grep -q '"status":"ok"'

echo "→ Health RAG (via API)"
curl -fsS "$BASE/api/system/rag-health" | tee /dev/stderr | grep -q '"crawl4ai_enabled":true'

echo "→ Frontend"
curl -fsS "$BASE/" | grep -q "<title>"

echo "✓ Deploy saludable"
```

`/api/system/rag-health` es un endpoint nuevo que el backend expone proxy-ando el `/health` del RAG (sin exponer la URL directa del contenedor).

---

## 11. Resumen del prompt para Claude Code (V1 + V2 + V3)

> Reconstruye **Asset Manager** integrando las tres iteraciones (V1, V2, V3) en un único monorepo pnpm + TypeScript desplegable con Docker Compose sobre Ubuntu LTS + Nginx + Cloudflare en `https://rcoloma.dev/evidencias`.
>
> Aplica las decisiones de V2 (multi-proyecto colaborativo, roles owner/editor/viewer, capa de servicios, errores tipados, `pg-boss`) y las de V3:
>
> 1. **Ingesta de catálogo de KPIs con IA**: parser estructural con SheetJS → muestreo de hojas → llamada a Claude Haiku que devuelve `{ sheet, header_row, column_mapping, skip_rows }` validado con Zod → vista de "revisar mapeo" en el frontend → commit del mapeo a `kpi_schema_templates` (caché por `header_signature` para evitar volver a llamar al LLM si el formato se repite) → parser determinístico aplica el mapping → diff vs catálogo actual → preview → commit transaccional.
> 2. **Ingesta de evidencias con formato fijo**: una sola hoja `evidencias` con 19 columnas exactas (§3), plantilla descargable generada con `exceljs` (incluye hoja `kpis` read-only, hoja `enums` con data validation y hoja `instrucciones`). Validación Zod estricta por fila. Upsert por clave natural `(project_id, kpi_external_code, empresa_comparable, ano)`. Modos `upsert` y `replace` (este último requiere confirmación con el nombre del proyecto). Export simétrico `download.xlsx` con el mismo schema.
> 3. **Despliegue self-hosted**:
>    - `deploy/docker-compose.yml` con servicios `postgres` (16-alpine), `rag` (build de `scripts/Dockerfile`), `api` (build de `artifacts/api-server/Dockerfile`, `ROLE=api`), `worker` (mismo image, `ROLE=worker`), `web` (nginx:alpine sirviendo el `dist` del frontend).
>    - Postgres NO expone puerto al host; los contenedores `api` y `web` exponen sólo en `127.0.0.1`.
>    - `deploy/nginx/rcoloma.dev.conf`: Nginx en el host con TLS de Cloudflare Origin Cert, `client_max_body_size 15M`, `proxy_buffering off` en `/evidencias/api/` para SSE, `location /evidencias/ → web`, `location /evidencias/api/ → api`.
>    - **Subpath `/evidencias`** propagado: `BASE_PATH` en env → `vite base` + `wouter base` + `setBaseUrl` del cliente + `app.use(\`${basePath}/api\`)` en Express + `cookie.path = basePath`.
>    - `scripts/backup.sh` con `pg_dump | gzip` y rotación 14 días, ejecutado por `systemd timer` diario.
>    - `deploy/scripts/deploy.sh` para `git pull + docker compose build + migrate + up -d + healthcheck`.
>    - GitHub Actions opcional con `appleboy/ssh-action` para deploy automático en push a `main`.
>    - Hardening del host: ufw 22/80/443, fail2ban, unattended-upgrades, SSH key-only, usuario `rodrigo` no-root con grupo `docker`.
>
> Reglas:
> - **El LLM NUNCA se llama para parsear evidencias**, sólo para descubrir el schema del Excel de catálogo. La ingesta de evidencias es 100 % determinística.
> - **`kpi_schema_templates` es por proyecto, no global**: dos proyectos con Excels parecidos no comparten template.
> - **El descubridor de schema tiene `temperature=0`** y reintenta una vez con feedback si la validación post-respuesta falla.
> - **Toda mutación del catálogo o de evidencias va en `db.transaction()`** y devuelve un resumen `{ added, updated, removed?, unchanged, errors }`.
> - **El subpath `/evidencias` se trata como configuración**, no como literal: respeta `BASE_PATH` en toda la pila.
> - **El secret de Postgres** se gestiona con `docker secrets` (file mounted en `/run/secrets/postgres_password`), no con env vars directas.
> - **No se usan servicios de Replit** (`@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner`, `@replit/vite-plugin-runtime-error-modal`): se eliminan del `package.json` y del `vite.config.ts`.
>
> Orden de PRs:
> 1. **PR1 (V2-base)**: schema multi-proyecto + auth real + capa de servicios + pg-boss.
> 2. **PR2 (V3-ingesta-evidencias)**: schema fijo de Excel de evidencias + plantilla `exceljs` + upsert por clave natural + endpoints `import` / `template.xlsx` / `download.xlsx`.
> 3. **PR3 (V3-ingesta-KPIs-IA)**: parser estructural + descubridor IA + `kpi_schema_templates` + parser determinístico + diff + preview + commit. Cachea el mapping por `header_signature`.
> 4. **PR4 (V3-deploy)**: Dockerfiles, `deploy/docker-compose.yml`, `nginx/rcoloma.dev.conf`, scripts de backup/deploy/healthcheck, `systemd` units, GitHub Actions. Propagar `BASE_PATH=/evidencias` en frontend + backend + cookies + tests.
> 5. **PR5 (limpieza)**: eliminar plugins de Replit, eliminar `.replit*`, eliminar `data/evidencias_seed.json` y `data/bdd_indicadores_catalog.json` del bundle (quedan como fixtures en `tests/fixtures/`), revisar imports JSON estáticos en runtime.
>
> Si encuentras ambigüedades sobre el schema del Excel del cliente o sobre el comportamiento del descubridor con un caso patológico (p. ej. dos hojas con cabeceras parecidas), **pregunta antes de inventar**. El usuario prefiere que el agente reporte `LOW_CONFIDENCE` y obligue a revisión humana, antes que adivinar mal.

---

## 12. Cuadro resumen V1 → V2 → V3

```
                      V1                V2                          V3
───────────────       ───────           ─────────────────           ─────────────────────────────
Tenancy               single ILUNION    multi-proyecto colab.       (igual)
Auth                  admin/EFQM_2026   users + argon2 + roles      (igual)
Capas backend         mezcladas         routes → svc → repo         (igual)
Jobs                  síncronos 300s    pg-boss + SSE               (igual)
Ingesta KPIs          JSON estático     Excel determinístico        Excel + IA discoverer
Ingesta evidencias    no                no                          Excel formato FIJO + upsert
Plantilla Excel       no                no                          download.xlsx generada con exceljs
Deploy                Replit autoscale  Replit autoscale            Docker Compose + Ubuntu + Nginx + CF
URL                   subdominio repl   subdominio repl             https://rcoloma.dev/evidencias
TLS                   Replit            Replit                      Cloudflare Origin Cert
Backups               Replit snapshots  Replit snapshots            pg_dump diario + R2 opcional
Subpath               /                 /                           /evidencias propagado
Coste IA              alto (gather)     alto + cache prompts        + ingest KPIs (~$0.005 / xlsx)
```

---

*Documento V3 generado tras las decisiones acordadas (parser IA para KPIs, formato fijo para evidencias, despliegue self-hosted con Docker Compose + Nginx + Cloudflare en `https://rcoloma.dev/evidencias`).*
