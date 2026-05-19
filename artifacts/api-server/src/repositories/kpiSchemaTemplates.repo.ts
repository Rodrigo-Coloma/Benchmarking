import { and, desc, eq, sql } from "drizzle-orm";
import {
  kpi_schema_templates,
  type Db,
  type KpiSchemaTemplate,
  type NewKpiSchemaTemplate,
  type Tx,
} from "@workspace/db";

type Executor = Db | Tx;

export async function findByProjectAndSignature(
  exec: Executor,
  projectId: string,
  headerSignature: string,
): Promise<KpiSchemaTemplate | undefined> {
  const [row] = await exec
    .select()
    .from(kpi_schema_templates)
    .where(
      and(
        eq(kpi_schema_templates.project_id, projectId),
        eq(kpi_schema_templates.header_signature, headerSignature),
      ),
    )
    .limit(1);
  return row;
}

export async function listByProject(
  exec: Executor,
  projectId: string,
): Promise<KpiSchemaTemplate[]> {
  return exec
    .select()
    .from(kpi_schema_templates)
    .where(eq(kpi_schema_templates.project_id, projectId))
    .orderBy(desc(kpi_schema_templates.last_used_at));
}

export async function upsert(
  exec: Executor,
  input: NewKpiSchemaTemplate,
): Promise<KpiSchemaTemplate> {
  const existing = await findByProjectAndSignature(
    exec,
    input.project_id,
    input.header_signature,
  );
  if (existing) {
    const [row] = await exec
      .update(kpi_schema_templates)
      .set({
        sheet_name: input.sheet_name,
        header_row: input.header_row,
        column_mapping: input.column_mapping,
        skip_rows: input.skip_rows ?? [],
        notes: input.notes ?? null,
        last_used_at: new Date(),
        uses_count: sql`${kpi_schema_templates.uses_count} + 1`,
      })
      .where(eq(kpi_schema_templates.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await exec
    .insert(kpi_schema_templates)
    .values({ ...input, last_used_at: new Date(), uses_count: 1 })
    .returning();
  return row;
}

export async function bumpUses(
  exec: Executor,
  id: string,
): Promise<void> {
  await exec
    .update(kpi_schema_templates)
    .set({
      last_used_at: new Date(),
      uses_count: sql`${kpi_schema_templates.uses_count} + 1`,
    })
    .where(eq(kpi_schema_templates.id, id));
}
