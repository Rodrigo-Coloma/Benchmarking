import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
// `pg` es CJS — Node ESM no puede destructurar `Pool` con named imports.
// Importamos el namespace default y desestructuramos en runtime; el tipo
// `Pool` se importa por separado porque los `type` imports son inocuos en
// runtime (TypeScript los elimina al compilar).
import pg, { type Pool, type PoolConfig } from "pg";
const PoolCtor = pg.Pool;
import * as schema from "./schema/index.js";

export * from "./schema/index.js";
export { schema };

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let _pool: Pool | undefined;
let _db: Db | undefined;

export interface CreateDbOptions {
  connectionString?: string;
  poolConfig?: Partial<PoolConfig>;
}

export function createDb(opts: CreateDbOptions = {}): { pool: Pool; db: Db } {
  const connectionString =
    opts.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está configurada");
  }

  const pool = new PoolCtor({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    ...opts.poolConfig,
  });

  const db = drizzle(pool, { schema });
  return { pool, db };
}

/**
 * Singleton lazily-inicializado. Útil para scripts y workers que no quieren
 * pasar el `db` por inyección de dependencias.
 */
export function getDb(): Db {
  if (!_db) {
    const { pool, db } = createDb();
    _pool = pool;
    _db = db;
  }
  return _db;
}

export function getPool(): Pool {
  if (!_pool) {
    getDb();
  }
  return _pool!;
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
    _db = undefined;
  }
}
