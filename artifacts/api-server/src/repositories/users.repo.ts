import { eq } from "drizzle-orm";
import { users, type Db, type NewUser, type Tx, type User } from "@workspace/db";

type Executor = Db | Tx;

export async function findByEmail(
  exec: Executor,
  email: string,
): Promise<User | undefined> {
  const [row] = await exec
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return row;
}

export async function findById(
  exec: Executor,
  id: string,
): Promise<User | undefined> {
  const [row] = await exec.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export async function insertUser(
  exec: Executor,
  input: NewUser,
): Promise<User> {
  const [row] = await exec
    .insert(users)
    .values({ ...input, email: input.email.toLowerCase() })
    .returning();
  return row;
}

export async function touchLastLogin(
  exec: Executor,
  userId: string,
): Promise<void> {
  await exec
    .update(users)
    .set({ last_login_at: new Date() })
    .where(eq(users.id, userId));
}

export async function updateProfile(
  exec: Executor,
  userId: string,
  patch: Partial<Pick<User, "name">>,
): Promise<User> {
  const [row] = await exec
    .update(users)
    .set(patch)
    .where(eq(users.id, userId))
    .returning();
  return row;
}
