import { z } from "zod";

/**
 * Validación de variables de entorno al arranque. Falla rápido si falta algo
 * crítico. Devuelve un objeto frozen e inmutable.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  BASE_PATH: z
    .string()
    .regex(/^\/.*[^/]$|^\/$/, "BASE_PATH debe empezar por / y no terminar en /")
    .default("/"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),

  SESSION_SECRET: z.string().min(16).default("dev-only-insecure-session-secret"),
  COOKIE_NAME: z.string().default("assetmgr.sid"),
  COOKIE_DOMAIN: z.string().optional(),

  ARGON2_SECRET: z.string().min(16).default("dev-only-insecure-argon2-secret"),

  // LLM / RAG — opcionales en PR1
  AI_INTEGRATIONS_ANTHROPIC_BASE_URL: z.string().url().optional(),
  AI_INTEGRATIONS_ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  RAG_URL: z.string().url().optional(),

  // Jobs
  JOB_CONCURRENCY_GATHER: z.coerce.number().int().positive().default(3),
  JOB_CONCURRENCY_VALIDATE: z.coerce.number().int().positive().default(6),
  ROLE: z.enum(["api", "worker", "both"]).default("both"),

  // Storage temporal para uploads de Excel
  STORAGE_DIR: z.string().default("/tmp/uploads"),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // Email — todo opcional, default = no enviar
  EMAIL_PROVIDER: z.enum(["none", "resend", "sendgrid"]).default("none"),
  EMAIL_FROM: z.string().default("noreply@local"),
  RESEND_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "[env] Validación falló:",
      JSON.stringify(parsed.error.format(), null, 2),
    );
    throw new Error("Configuración de entorno inválida");
  }

  // En prod, exigir secrets robustos.
  if (parsed.data.NODE_ENV === "production") {
    if (parsed.data.SESSION_SECRET.startsWith("dev-only")) {
      throw new Error("SESSION_SECRET inseguro en producción");
    }
    if (parsed.data.ARGON2_SECRET.startsWith("dev-only")) {
      throw new Error("ARGON2_SECRET inseguro en producción");
    }
  }

  cached = Object.freeze(parsed.data);
  return cached;
}
