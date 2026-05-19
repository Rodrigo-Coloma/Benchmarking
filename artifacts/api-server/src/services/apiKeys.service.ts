import { getDb } from "@workspace/db";
import * as repo from "../repositories/apiKeys.repo.js";
import { randomToken, sha256 } from "../lib/hashing.js";
import { NotFoundError } from "../lib/errors.js";

const TOKEN_PREFIX = "amk_"; // asset manager key

export async function list(projectId: string) {
  return repo.listByProject(getDb(), projectId);
}

export async function create(
  projectId: string,
  userId: string,
  input: { name: string; scopes: string[] },
) {
  const db = getDb();
  const token = `${TOKEN_PREFIX}${randomToken(24)}`;
  const token_hash = sha256(token);
  const row = await repo.insert(db, {
    project_id: projectId,
    created_by: userId,
    name: input.name,
    scopes: input.scopes,
    token_hash,
  });
  return { ...row, token }; // token plano SÓLO se devuelve aquí
}

export async function revoke(projectId: string, keyId: string) {
  const db = getDb();
  const keys = await repo.listByProject(db, projectId);
  const target = keys.find((k) => k.id === keyId);
  if (!target) {
    throw new NotFoundError("EVIDENCE_NOT_FOUND", "API key no encontrada");
  }
  await repo.revoke(db, keyId);
}
