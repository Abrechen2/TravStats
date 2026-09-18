/**
 * The evidence contract — what "which entries produced this number" answers
 * with, and the keys that name a number.
 *
 * MIRRORED at `frontend/src/shared/evidence.ts`; change both together. Each
 * side has its own test of the same truth table, which is the convention in
 * this codebase — nothing checks the mirror itself.
 */
export type EvidenceKind = "achievement" | "metric" | "ranking" | "record";

export const EVIDENCE_METRICS = [
  "countries",
  "flights",
  "nights",
  "portCalls",
  "places",
  "distanceKm",
  "activeDays",
] as const;
export type EvidenceMetric = (typeof EVIDENCE_METRICS)[number];

export const RANKING_DIMENSIONS = [
  "airline",
  "airport",
  "country",
  "continent",
  "aircraftType",
] as const;
export type RankingDimension = (typeof RANKING_DIMENSIONS)[number];

/** `airline:LH`. The FIRST colon separates; the value keeps any others. */
export function rankingKey(dimension: RankingDimension, value: string): string {
  return `${dimension}:${value}`;
}

export function parseRankingKey(
  key: string
): { dimension: RankingDimension; value: string } | null {
  const at = key.indexOf(":");
  if (at <= 0) return null;
  const dimension = key.slice(0, at) as RankingDimension;
  if (!RANKING_DIMENSIONS.includes(dimension)) return null;
  const value = key.slice(at + 1);
  return value ? { dimension, value } : null;
}

export type UnattributedReason = "transitOnly" | "entryRemoved" | "notPerEntry";
export type EvidenceDomain = "flight" | "cruise" | "lodging" | "place" | "trip";

export interface EvidenceEntry {
  domain: EvidenceDomain;
  id: string;
  title: string;
  subtitle: string | null;
  date: string | null;
  href: string | null;
  /** What this row contributes to `metric.value`, in `metric.unit`. */
  contribution: number;
}

export interface EvidenceResponse {
  metric: { kind: EvidenceKind; key: string; label: string; value: number; unit: string };
  entries: EvidenceEntry[];
  total: number;
  truncated: boolean;
  unattributed?: { count: number; reason: UnattributedReason };
}

/** Beyond this the panel offers the logbook filter instead of a second table. */
export const EVIDENCE_ENTRY_CAP = 200;
