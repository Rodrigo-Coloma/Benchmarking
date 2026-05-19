import { and, eq } from "drizzle-orm";
import {
  project_members,
  users,
  type Db,
  type ProjectMember,
  type Role,
  type Tx,
} from "@workspace/db";

type Executor = Db | Tx;

export async function add(
  exec: Executor,
  input: {
    project_id: string;
    user_id: string;
    role: Role;
    added_by?: string;
  },
): Promise<ProjectMember> {
  const [row] = await exec.insert(project_members).values(input).returning();
  return row;
}

export async function findOne(
  exec: Executor,
  projectId: string,
  userId: string,
): Promise<ProjectMember | undefined> {
  const [row] = await exec
    .select()
    .from(project_members)
    .where(
      and(
        eq(project_members.project_id, projectId),
        eq(project_members.user_id, userId),
      ),
    )
    .limit(1);
  return row;
}

export interface MemberRow extends ProjectMember {
  email: string;
  name: string;
}

export async function listByProject(
  exec: Executor,
  projectId: string,
): Promise<MemberRow[]> {
  const rows = await exec
    .select({
      project_id: project_members.project_id,
      user_id: project_members.user_id,
      role: project_members.role,
      added_by: project_members.added_by,
      added_at: project_members.added_at,
      email: users.email,
      name: users.name,
    })
    .from(project_members)
    .innerJoin(users, eq(users.id, project_members.user_id))
    .where(eq(project_members.project_id, projectId));

  return rows.map((r) => ({
    ...r,
    role: r.role,
  })) as MemberRow[];
}

export async function updateRole(
  exec: Executor,
  projectId: string,
  userId: string,
  role: Role,
): Promise<ProjectMember> {
  const [row] = await exec
    .update(project_members)
    .set({ role })
    .where(
      and(
        eq(project_members.project_id, projectId),
        eq(project_members.user_id, userId),
      ),
    )
    .returning();
  return row;
}

export async function remove(
  exec: Executor,
  projectId: string,
  userId: string,
): Promise<void> {
  await exec
    .delete(project_members)
    .where(
      and(
        eq(project_members.project_id, projectId),
        eq(project_members.user_id, userId),
      ),
    );
}
