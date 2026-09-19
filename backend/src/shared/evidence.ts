/**
 * The evidence contract — what "which entries produced this number" answers
 * with, and the keys that name a number.
 *
 * Rewritten against `docs/superpowers/specs/2026-09-18-evidence-panel-design.md`
 * ("The contract"), which supersedes the shape this module carried as of
 * `ee83027d`. That first shape assumed one invariant held for every kind of
 * number — `sum(contribution) + unattributed === value` — and an independent
 * review refuted it with code: ten flights prove ONE country while one
 * international flight proves TWO, a layover's evidence is two flights not
 * one, and a page boundary is KNOWN evidence, not unattributed evidence. The
 * per-kind model in the spec ("The model: aggregation kinds") is the fix; see
 * that document before extending this one.
 *
 * MIRRORED at `frontend/src/shared/evidence.ts`; change both together. Each
 * side has its own test of the same truth table, which is the convention in
 * this codebase — nothing checks the mirror itself.
 */

/**
 * `achievement` and `record` are declared here although release 1 serves
 * neither (`docs/.../evidence-panel-design.md`, "Release 2"). Adding them
 * later would change this union's shape under every consumer — the panel,
 * the key parser, the OpenAPI schema — so they are in from the start, and
 * the endpoint answers 501 for them until release 2 lands.
 */
export type EvidenceKind = "metric" | "ranking" | "record" | "achievement";

export type EvidenceDomain = "flight" | "cruise" | "lodging" | "place" | "trip";

/**
 * One invariant per kind, not one invariant for everything — the exact
 * mistake the first version made (see the module header). What counts as
 * "the evidence" differs by kind: a `sum` row carries a raw contribution: `sum`
 * still uses `contribution`; `distinct` needs the units a row *witnesses*, not
 * a scalar, because one flight can witness two countries; `extremum` and
 * `sequence` are witness sets a scalar cannot express at all. Release 1
 * serves only `sum` and `distinct` (`docs/.../evidence-panel-design.md`,
 * "Release 1"); the rest exists so the type does not grow when release 2
 * adds them.
 */
export type Aggregation = "sum" | "distinct" | "extremum" | "ratio" | "boolean" | "sequence";

/**
 * Why a unit of the number has no row to name. This is a closed vocabulary,
 * not free text, because the panel renders one sentence per reason and a
 * fifth "other" reason would need a sixth code path anyway.
 */
export type UnattributedReason =
  /**
   * Proved by stored location history (`CountryDay`) rather than by a
   * logbook entry. Deliberately NOT called `transitOnly` (the first
   * version's name): `trackEvidence.ts` can classify a tracked country as
   * `slept` or `visited`, and "transit" would assert a classification the
   * engine never made.
   */
  | "locationHistoryOnly"
  /** The row that proved it is gone; the number is historical, not live. */
  | "entryRemoved"
  /** The measure is derived across the whole set and has no per-row split. */
  | "notPerEntry";

export interface EvidenceScope {
  /** What population the number was measured over. Mirrors the surface. */
  period: { kind: "allTime" } | { kind: "year"; year: number } | { kind: "rolling12m" };
  /** Only where the surface is domain-filtered (the overview is). */
  domains?: EvidenceDomain[];
}

export interface EvidenceMeasure {
  kind: EvidenceKind;
  key: string;
  aggregation: Aggregation;
  /** i18n KEY plus values — never a server-rendered string; see `EvidenceEntry.title`. */
  label: { key: string; values?: Record<string, string | number> };
  unit: string;
  /**
   * `number | null`, not `number` defaulting to 0. A measure that cannot be
   * derived (no data to decide it) is not the same fact as a measure that
   * was derived and is genuinely zero — collapsing the two would print "0"
   * for a question the backend never answered. The type forces every caller
   * to branch on `null` instead of trusting a falsy-but-valid 0.
   */
  value: number | null;
  scope: EvidenceScope;
  /** `ratio` only: both sides, so the percentage can be explained rather than asserted. */
  numerator?: number;
  denominator?: number;
}

export interface EvidenceEntry {
  domain: EvidenceDomain;
  /** Identity of the EVIDENCE — a stay id, a port-call id — not of `href`'s target. */
  id: string;
  /** Where the user goes. A stay's target is its lodging, which may differ from `id`. */
  href: string | null;
  /** `{ text }` covers a user-entered name (a hotel's name is not translatable). */
  title: { key: string; values?: Record<string, string | number> } | { text: string };
  subtitle: { key: string; values?: Record<string, string | number> } | { text: string } | null;
  /** The surface's own clock rule, with its precision kept — never flattened to a day. */
  date: { value: string; precision: "day" | "month" | "year" } | null;
  /** `sum` only, RAW and unrounded — rounding happens once, after aggregation, at the surface. */
  contribution?: number;
  /** `distinct` only: the units this row witnesses ("DE", "MUC", "2026-04-02"). */
  credits?: string[];
  /**
   * `distinct` only: a DISPLAY name per credit key, where the key is not one
   * itself. A credit is an identity key for the union and stays one — that is
   * what makes two rows witnessing the same unit count once — so an
   * entity-keyed measure credits a UUID, and the panel printed
   * "belegt: 0d02459d-4677-…" for every place and every lodging
   * (browser pass, 2026-09-19).
   *
   * A key with NO entry here renders as itself, which is right and is why
   * this is not `Record<string, string>` filled everywhere: "MUC", "DE" and
   * "Europe" ARE the reader's words, and inventing a lookup for them would
   * be a second place to be wrong about what an airport is called.
   */
  creditLabels?: Record<string, string>;
}

export interface EvidenceResponse {
  measure: EvidenceMeasure;
  entries: EvidenceEntry[];
  returned: number;
  /**
   * Rows beyond the current page. These are KNOWN evidence — the backend
   * could name them, it just hasn't paged there yet — which is a different
   * fact from `unattributed` (rows that cannot be named at all). Merging the
   * two buckets was the first version's `truncated: boolean` flag; it could
   * not say "12 more rows" and "3 flights proved by location history only"
   * as two separate numbers, which is what the panel needs to render.
   */
  omitted: { count: number; contribution?: number; credits?: number };
  /**
   * An ARRAY: a count can be short a row for more than one reason at once
   * (some units proved only by location history, others whose row was since
   * deleted), and collapsing that to one `{ count, reason }` pair would
   * silently pick one reason and hide the rest.
   */
  unattributed: Array<{ count: number; reason: UnattributedReason }>;
  page: { offset: number; limit: number };
}

/** Default page size; paging replaces the first version's hard entry cap. */
export const EVIDENCE_PAGE_SIZE = 100;

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

/**
 * Rejects rather than guesses on anything but a clean `dimension:value`: an
 * empty key, a bare separator, an empty dimension or value, and a dimension
 * that is merely a PREFIX of a real one ("air" vs "airline") all return
 * `null` instead of a plausible-looking match — a naive `split(":")` or a
 * truthiness check on `dimension` would let one of those through silently.
 */
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
