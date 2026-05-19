/**
 * Cliente HTTP base usado por los hooks generados por Orval.
 *
 * - Manda cookies con `credentials: "include"`.
 * - Permite configurar el `baseUrl` (útil para el subpath `/evidencias` de V3).
 * - Convierte 4xx/5xx en `ApiError` con el shape estándar del backend.
 */

let baseUrl = "/api";

export function setBaseUrl(url: string): void {
  // Normaliza para que no termine en "/"
  baseUrl = url.replace(/\/+$/, "");
}

export function getBaseUrl(): string {
  return baseUrl;
}

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: unknown;
  traceId?: string;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly traceId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.traceId = body.traceId;
  }
}

export class ResponseParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ResponseParseError";
  }
}

interface CustomFetchInit extends Omit<RequestInit, "body"> {
  url: string;
  params?: Record<string, string | number | boolean | undefined | null>;
  data?: unknown;
  responseType?: "json" | "blob" | "text";
  signal?: AbortSignal;
}

function buildQuery(
  params?: CustomFetchInit["params"],
): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function customFetch<T>(init: CustomFetchInit): Promise<T> {
  const { url, params, data, responseType = "json", signal, ...rest } = init;
  const fullUrl = `${baseUrl}${url}${buildQuery(params)}`;

  const headers = new Headers(rest.headers ?? {});
  if (data !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(fullUrl, {
    ...rest,
    headers,
    credentials: "include",
    body: data === undefined ? undefined : JSON.stringify(data),
    signal,
  });

  if (!res.ok) {
    let body: ApiErrorBody = {
      error: res.statusText || "HTTP error",
      code: "INTERNAL_ERROR",
    };
    try {
      const text = await res.text();
      if (text) body = JSON.parse(text) as ApiErrorBody;
    } catch {
      /* keep default body */
    }
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  try {
    if (responseType === "blob") {
      return (await res.blob()) as unknown as T;
    }
    if (responseType === "text") {
      return (await res.text()) as unknown as T;
    }
    return (await res.json()) as T;
  } catch (err) {
    throw new ResponseParseError("Could not parse response", err);
  }
}

export default customFetch;
