/**
 * Stored findings read as one envelope (TravTrack plan E1): a stay row of
 * `dawarich_stays` and a country or journey row of `location_suggestions`
 * answer in the same shape. What is server-side stays server-side — the
 * envelope is built from named fields only, so no evidence key, fingerprint,
 * point id or digest can ride along.
 */
import type { Coverage } from "../locationProvider/types";
import {
  EVIDENCE_PROVIDERS,
  type EvidenceAlgorithm,
  type EvidenceKind,
  type EvidenceProvider,
  type EvidenceStatus,
  type EvidenceSuggested,
  type Explanation,
} from "./types";

/** A code: dotted lower-camel segments, e.g. `stay.legacy`, `journey.unlogged`. */
const CODE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const COVERAGES: readonly Coverage[] = ["complete", "truncated", "unreachable"];

const isScalar = (v: unknown): v is number | string =>
  typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A stored explanation, or null when it is not one. */
export function parseExplanation(value: unknown): Explanation | null {
  if (!isRecord(value) || typeof value.code !== "string" || !CODE.test(value.code)) return null;
  const params = value.params;
  if (!isRecord(params) || !Object.values(params).every(isScalar)) return null;
  return { code: value.code, params: { ...(params as Record<string, number | string>) } };
}

/** A new explanation. Throws on anything a stored one may not be. */
export function explanation(code: string, params: Record<string, number | string>): Explanation {
  const parsed = parseExplanation({ code, params });
  if (!parsed) throw new Error(`not an explanation: ${JSON.stringify(code)}`);
  return parsed;
}

const parseProvider = (v: unknown): EvidenceProvider | null =>
  (EVIDENCE_PROVIDERS as readonly unknown[]).includes(v) ? (v as EvidenceProvider) : null;

const parseCoverage = (v: unknown): Coverage | null =>
  (COVERAGES as readonly unknown[]).includes(v) ? (v as Coverage) : null;

/** A stay row of `dawarich_stays`, as far as the envelope reads it. */
export type StayRow = {
  id: string;
  status: string;
  startAt: Date;
  endAt: Date;
  provider: string;
  providerRev: number;
  algorithmVersion: number;
  evidence: unknown;
};

/** A row of `location_suggestions`, as far as the envelope reads it. */
export type SuggestionRow = {
  id: string;
  kind: string;
  provider: string;
  providerRev: number;
  algorithm: number;
  windowFrom: Date;
  windowUntil: Date;
  status: string;
  explanation: unknown;
  evidence: unknown;
};

/** `accepting` is the accept protocol's own state (E4); outside it the finding is still open. */
function parseStatus(status: string, allowed: readonly EvidenceStatus[]): EvidenceStatus | null {
  if (status === "accepting") return "pending";
  return (allowed as readonly string[]).includes(status) ? (status as EvidenceStatus) : null;
}

const STAY_STATUSES: readonly EvidenceStatus[] = [
  "pending",
  "accepted",
  "rejected",
  "invalidated",
  "covered",
  "superseded",
];
const SUGGESTION_STATUSES: readonly EvidenceStatus[] = [
  "pending",
  "accepted",
  "rejected",
  "invalidated",
];

function stayEnvelope(row: StayRow): EvidenceSuggested | null {
  const provider = parseProvider(row.provider);
  const status = parseStatus(row.status, STAY_STATUSES);
  if (!provider || !status) return null;
  const evidence = isRecord(row.evidence) ? row.evidence : {};
  const kind: EvidenceKind =
    evidence.kind === "market" || evidence.kind === "venue" ? evidence.kind : "stay";
  const name: EvidenceAlgorithm = kind === "stay" ? "stay" : "market";
  const legacy = row.algorithmVersion === 0;
  return {
    id: row.id,
    kind,
    provider: { kind: provider, rev: row.providerRev },
    window: { fromMs: row.startAt.getTime(), untilMs: row.endAt.getTime() },
    algorithm: { name, version: row.algorithmVersion },
    explanation: legacy
      ? { code: `${name}.legacy`, params: {} }
      : (parseExplanation(evidence.explanation) ?? { code: `${name}.unexplained`, params: {} }),
    status,
    coverage: legacy ? null : parseCoverage(evidence.readCoverage),
  };
}

function suggestionEnvelope(row: SuggestionRow): EvidenceSuggested | null {
  const provider = parseProvider(row.provider);
  const status = parseStatus(row.status, SUGGESTION_STATUSES);
  if (!provider || !status || (row.kind !== "country" && row.kind !== "journey")) return null;
  const evidence = isRecord(row.evidence) ? row.evidence : {};
  return {
    id: row.id,
    kind: row.kind,
    provider: { kind: provider, rev: row.providerRev },
    window: { fromMs: row.windowFrom.getTime(), untilMs: row.windowUntil.getTime() },
    algorithm: { name: row.kind, version: row.algorithm },
    explanation: parseExplanation(row.explanation) ?? {
      code: `${row.kind}.unexplained`,
      params: {},
    },
    status,
    coverage: parseCoverage(evidence.readCoverage),
  };
}

/**
 * A stored finding as its envelope, or null when the row holds a provider,
 * kind or status this build does not know (a row written by a newer build).
 */
export function toEnvelope(row: StayRow | SuggestionRow): EvidenceSuggested | null {
  return "algorithmVersion" in row ? stayEnvelope(row) : suggestionEnvelope(row);
}
