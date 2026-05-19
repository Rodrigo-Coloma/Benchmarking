import { and, eq, isNull, desc } from "drizzle-orm";
import {
  projects,
  project_members,
  users,
  type Db,
  type NewProject,
  type Project,
  type Role,
  type Tx,
} from "@workspace/db";

type Executor = Db | Tx;

export async function insert(
  exec: Executor,
  input: NewProject,
): Promise<Project> {
  const [row] = await exec.insert(projects).values(input).returning();
  return row;
}

export async function findById(
  exec: Executor,
  id: string,
): Promise<Project | undefined> {
  const [row] = await exec
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return row;
}

export async function findBySlug(
  exec: Executor,
  slug: string,
): Promise<Project | undefined> {
  const [row] = await exec
    .select()
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return row;
}

export interface ProjectWithRole extends Project {
  role: Role;
}

export async function listForUser(
  exec: Executor,
  userId: string,
): Promise<ProjectWithRole[]> {
  const rows = await exec
    .select({
      project: projects,
      role: project_members.role,
    })
    .from(project_members)
    .innerJoin(projects, eq(projects.id, project_members.project_id))
    .where(
      and(
        eq(project_members.user_id, userId),
        isNull(projects.archived_at),
      ),
    )
    .orderBy(desc(projects.updated_at));

  return rows.map((r) => ({
    ...r.project,
    role: r.role as Role,
  }));
}

export async function update(
  exec: Executor,
  id: string,
  patch: Partial<Project>,
): Promise<Project> {
  const [row] = await exec
    .update(projects)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(projects.id, id))
    .returning();
  return row;
}

export async function archive(
  exec: Executor,
  id: string,
): Promise<Project> {
  return update(exec, id, { archived_at: new Date() });
}

export async function remove(exec: Executor, id: string): Promise<void> {
  await exec.delete(projects).where(eq(projects.id, id));
}

/**
 * Para mostrar el "created by" en la UI sin un join adicional en el caller.
 */
export async function findCreator(
  exec: Executor,
  projectId: string,
): Promise<{ id: string; name: string; email: string } | undefined> {
  const [row] = await exec
    .select({ id: users.id, name: users.name, email: users.email })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.created_by))
    .where(eq(projects.id, projectId))
    .limit(1);
  return row;
}
