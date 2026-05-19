import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { loadEnv } from "../env.js";

const env = loadEnv();

const argonOpts: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  secret: Buffer.from(env.ARGON2_SECRET, "utf8"),
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, argonOpts);
}

export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain, { secret: argonOpts.secret });
  } catch {
    return false;
  }
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
