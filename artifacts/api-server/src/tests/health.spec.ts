import { describe, it, expect, beforeAll, vi } from "vitest";

// Mockeamos @workspace/db ANTES de importar app.ts para evitar tener que
// arrancar Postgres en CI. requireProjectMembership lo importa indirectamente
// pero /healthz no toca DB, así que basta con stubear `getPool`.
vi.mock("@workspace/db", () => ({
  getDb: () => ({}),
  getPool: () => ({ query: vi.fn() }),
  closeDb: vi.fn(),
  // schema enums vacíos — no se usan en este test
  ROLES: ["owner", "editor", "viewer"],
  DIRECTIONS: ["ASCENDENTE", "DESCENDENTE", "NEUTRO"],
}));

import request from "supertest";

let app: import("express").Express;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://test:test@localhost/test";
  process.env.SESSION_SECRET = "dev-only-test-secret-1234567890";
  process.env.ARGON2_SECRET = "dev-only-test-secret-1234567890";
  const { buildApp } = await import("../app.js");
  app = buildApp();
});

describe("GET /api/healthz", () => {
  it("returns 200 ok", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({ status: "ok" }),
    );
  });
});
