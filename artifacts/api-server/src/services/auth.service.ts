import { getDb, type User } from "@workspace/db";
import { ConflictError, DomainError } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/hashing.js";
import * as usersRepo from "../repositories/users.repo.js";

export interface SignupInput {
  email: string;
  password: string;
  name: string;
}

export async function signup(input: SignupInput): Promise<User> {
  const db = getDb();
  const existing = await usersRepo.findByEmail(db, input.email);
  if (existing) {
    throw new ConflictError("USER_EXISTS", "Ese email ya está registrado");
  }
  const password_hash = await hashPassword(input.password);
  return usersRepo.insertUser(db, {
    email: input.email,
    name: input.name,
    password_hash,
  });
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function login(input: LoginInput): Promise<User> {
  const db = getDb();
  const user = await usersRepo.findByEmail(db, input.email);
  if (!user) {
    throw new DomainError("BAD_CREDENTIALS", "Credenciales inválidas", 401);
  }
  const ok = await verifyPassword(user.password_hash, input.password);
  if (!ok) {
    throw new DomainError("BAD_CREDENTIALS", "Credenciales inválidas", 401);
  }
  await usersRepo.touchLastLogin(db, user.id);
  return user;
}

export function toPublicUser(u: User): Pick<
  User,
  "id" | "email" | "name" | "created_at" | "last_login_at"
> {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  };
}
