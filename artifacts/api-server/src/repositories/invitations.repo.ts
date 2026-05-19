import { and, eq, gt, isNull } from "drizzle-orm";
import {
  project_invitations,
  type Db,
  type Invitation,
  type NewInvitation,
  type Tx,
} from "@workspace/db";

type Executor = Db | Tx;

export async function insert(
  exec: Executor,
  input: NewInvitation,
): Promise<Invitation> {
  const [row] = await exec
    .insert(project_invitations)
    .values(input)
    .returning();
  return row;
}

export async function findByToken(
  exec: Executor,
  token: string,
): Promise<Invitation | undefined> {
  const [row] = await exec
    .select()
    .from(project_invitations)
    .where(eq(project_invitations.token, token))
    .limit(1);
  return row;
}

export async function listPending(
  exec: Executor,
  projectId: string,
): Promise<Invitation[]> {
  return exec
    .select()
    .from(project_invitations)
    .where(
      and(
        eq(project_invitations.project_id, projectId),
        isNull(project_invitations.accepted_at),
        gt(project_invitations.expires_at, new Date()),
      ),
    );
}

export async function markAccepted(
  exec: Executor,
  id: string,
): Promise<void> {
  await exec
    .update(project_invitations)
    .set({ accepted_at: new Date() })
    .where(eq(project_invitations.id, id));
}

export async function remove(exec: Executor, id: string): Promise<void> {
  await exec
    .delete(project_invitations)
    .where(eq(project_invitations.id, id));
}
