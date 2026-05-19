import { and, desc, eq } from "drizzle-orm";
import {
  evidencia_imports,
  type Db,
  type EvidenciaImport,
  type NewEvidenciaImport,
  type Tx,
} from "@workspace/db";

type Executor = Db | Tx;

export async function insert(
  exec: Executor,
  input: NewEvidenciaImport,
): Promise<EvidenciaImport> {
  const [row] = await exec
    .insert(evidencia_imports)
    .values(input)
    .returning();
  return row;
}

export async function findById(
  exec: Executor,
  projectId: string,
  id: string,
): Promise<EvidenciaImport | undefined> {
  const [row] = await exec
    .select()
    .from(evidencia_imports)
    .where(
      and(
        eq(evidencia_imports.id, id),
        eq(evidencia_imports.project_id, projectId),
      ),
    )
    .limit(1);
  return row;
}

export async function listByProject(
  exec: Executor,
  projectId: string,
): Promise<EvidenciaImport[]> {
  return exec
    .select()
    .from(evidencia_imports)
    .where(eq(evidencia_imports.project_id, projectId))
    .orderBy(desc(evidencia_imports.created_at));
}

export async function markCommitted(
  exec: Executor,
  id: string,
  summary: unknown,
): Promise<EvidenciaImport> {
  const [row] = await exec
    .update(evidencia_imports)
    .set({
      status: "committed",
      committed_at: new Date(),
      summary: summary as never,
    })
    .where(eq(evidencia_imports.id, id))
    .returning();
  return row;
}

export async function markDiscarded(
  exec: Executor,
  id: string,
): Promise<void> {
  await exec
    .update(evidencia_imports)
    .set({ status: "discarded" })
    .where(eq(evidencia_imports.id, id));
}
