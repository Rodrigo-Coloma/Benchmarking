import type { Kpi } from "@workspace/db";
import type { ParsedKpi } from "./deterministic.js";

export type DiffKind = "new" | "updated" | "removed" | "unchanged";

export interface KpiDiffRow {
  kind: DiffKind;
  external_code: string;
  parsed?: ParsedKpi;
  current?: Kpi;
  changes?: Record<string, { old: unknown; new: unknown }>;
}

export interface KpiDiffSummary {
  new: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Counts how many "removed" rows have associated evidences in BBDD. */
  removed_with_evidence: number;
}

export interface KpiDiff {
  rows: KpiDiffRow[];
  summary: KpiDiffSummary;
}

const COMPARABLE_FIELDS: (keyof ParsedKpi)[] = [
  "name",
  "scope",
  "responsible_area",
  "direction",
  "standard_unit",
  "category",
  "description",
  "comparable_companies",
  "extra",
];

/**
 * Diff por `external_code` entre el catálogo actual y el resultado del parser
 * determinístico. Las filas "removed" son sólo informativas — el commit
 * persiste un `archived_at` en lugar de borrar, para no perder evidencias.
 */
export function buildKpiDiff(opts: {
  current: Kpi[];
  parsed: ParsedKpi[];
  evidenceCountByKpiId?: Map<string, number>;
}): KpiDiff {
  const currentByCode = new Map<string, Kpi>();
  for (const k of opts.current) currentByCode.set(k.external_code, k);

  const parsedByCode = new Map<string, ParsedKpi>();
  for (const p of opts.parsed) parsedByCode.set(p.external_code, p);

  const rows: KpiDiffRow[] = [];
  const summary: KpiDiffSummary = {
    new: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    removed_with_evidence: 0,
  };

  for (const [code, parsed] of parsedByCode) {
    const current = currentByCode.get(code);
    if (!current) {
      rows.push({ kind: "new", external_code: code, parsed });
      summary.new += 1;
      continue;
    }
    const changes = diffFields(current, parsed);
    if (Object.keys(changes).length === 0) {
      rows.push({ kind: "unchanged", external_code: code, parsed, current });
      summary.unchanged += 1;
    } else {
      rows.push({
        kind: "updated",
        external_code: code,
        parsed,
        current,
        changes,
      });
      summary.updated += 1;
    }
  }

  for (const [code, current] of currentByCode) {
    if (parsedByCode.has(code)) continue;
    rows.push({ kind: "removed", external_code: code, current });
    summary.removed += 1;
    const evidenceCount =
      opts.evidenceCountByKpiId?.get(current.id) ?? 0;
    if (evidenceCount > 0) summary.removed_with_evidence += 1;
  }

  return { rows, summary };
}

function diffFields(
  current: Kpi,
  parsed: ParsedKpi,
): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of COMPARABLE_FIELDS) {
    const a = (current as Record<string, unknown>)[field];
    const b = (parsed as Record<string, unknown>)[field];
    if (!eqLoose(a, b)) out[field] = { old: a ?? null, new: b ?? null };
  }
  return out;
}

function eqLoose(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => eqLoose(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return String(a).trim() === String(b).trim();
}
