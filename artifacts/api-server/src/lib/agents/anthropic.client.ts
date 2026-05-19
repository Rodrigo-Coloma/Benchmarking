import Anthropic from "@anthropic-ai/sdk";
import { loadEnv } from "../../env.js";

let _client: Anthropic | undefined;

/**
 * Devuelve un cliente Anthropic singleton. Soporta tanto la API directa de
 * Anthropic (default) como el proxy de Replit AI Integrations (V1/V2). Si la
 * clave no está configurada, lanza para que el caller pueda manejarlo
 * (devolver 503 al usuario, p.ej.).
 */
export function getAnthropic(): Anthropic {
  if (_client) return _client;
  const env = loadEnv();
  const apiKey = env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI_INTEGRATIONS_ANTHROPIC_API_KEY no está configurada — la ingesta IA no puede ejecutarse",
    );
  }
  _client = new Anthropic({
    apiKey,
    baseURL: env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    timeout: 6_000_000,
  });
  return _client;
}

export const HAIKU_MODEL = "claude-haiku-4-5";

export interface UsageMetrics {
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

/** Coste estimado con tarifa Haiku 4.5: $1/M input, $5/M output. */
export function estimateCost(usage: {
  input_tokens?: number;
  output_tokens?: number;
}): UsageMetrics {
  const it = usage.input_tokens ?? 0;
  const ot = usage.output_tokens ?? 0;
  return {
    input_tokens: it,
    output_tokens: ot,
    estimated_cost_usd: Number(
      ((it / 1_000_000) * 1 + (ot / 1_000_000) * 5).toFixed(6),
    ),
  };
}
