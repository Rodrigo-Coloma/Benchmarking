import { and, eq, isNull } from "drizzle-orm";
import {
  api_keys,
  type ApiKey,
  type Db,
  type NewApiKey,
  type Tx,
} from "@workspace/db";

type Executor = Db | Tx;

export async function insert(
  exec: Executor,
  input: NewApiKey,
): Promise<ApiKey> {
  const [row] = await exec.insert(api_keys).values(input).returning();
  return row;
}

export async function listByProject(
  exec: Executor,
  projectId: string,
): Promise<ApiKey[]> {
  return exec
    .select()
    .from(api_keys)
    .where(eq(api_keys.project_id, projectId));
}

export async function findByHash(
  exec: Executor,
  tokenHash: string,
): Promise<ApiKey | undefined> {
  const [row] = await exec
    .select()
    .from(api_keys)
    .where(
      and(eq(api_keys.token_hash, tokenHash), isNull(api_keys.revoked_at)),
    )
    .limit(1);
  return row;
}

export async function revoke(exec: Executor, id: string): Promise<void> {
  await exec
    .update(api_keys)
    .set({ revoked_at: new Date() })
    .where(eq(api_keys.id, id));
}

export async function touchLastUsed(
  exec: Executor,
  id: string,
): Promise<void> {
  await exec
    .update(api_keys)
    .set({ last_used_at: new Date() })
    .where(eq(api_keys.id, id));
}
