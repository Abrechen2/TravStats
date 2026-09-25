import { z } from "./zod";
import type {
  Aggregation,
  EvidenceDomain,
  EvidenceEntry as SharedEvidenceEntry,
  EvidenceKind,
  EvidenceMeasure as SharedEvidenceMeasure,
  EvidenceResponse as SharedEvidenceResponse,
  EvidenceScope,
  UnattributedReason,
} from "../shared/evidence";
import { EVIDENCE_PAGE_SIZE } from "../shared/evidence";

/**
 * `GET /evidence/:kind/:key` — the response as a Zod schema, and the
 * TypeScript types the rest of the backend uses derived from it with
 * `z.infer`, the way `schemas/statsAircraft.ts` does.
 *
 * `docs/superpowers/specs/2026-09-18-evidence-panel-design.md` ("One schema,
 * not two shapes") is explicit that this supersedes a hand-maintained
 * interface: "the backend's TypeScript types are derived from it". So the
 * `EvidenceMeasure` / `EvidenceEntry` / `EvidenceResponse` types used inside
 * `services/evidence/*` and `routes/evidence.ts` come from THIS file, not
 * from `shared/evidence.ts` — that module keeps the interfaces as the
 * mirrored contract the frontend reads (it has no Zod schema of its own to
 * derive from), plus the vocabulary (kinds, domains, aggregations,
 * unattributed reasons, `EvidenceScope`, ranking-key helpers) both sides
 * import rather than restate.
 *
 * Zod cannot read a TypeScript union at runtime, so the enum literals below
 * are restated — but `satisfies readonly X[]` pins each array to its
 * `shared/evidence.ts` type: adding a value there without adding it here is
 * a compile error, not a silent gap in request validation.
 */

const EVIDENCE_KINDS = [
  "metric",
  "ranking",
  "record",
  "achievement",
] as const satisfies readonly EvidenceKind[];

const EVIDENCE_DOMAINS = [
  "flight",
  "cruise",
  "lodging",
  "place",
  "rail",
  "trip",
  "roadtrip",
] as const satisfies readonly EvidenceDomain[];

const AGGREGATIONS = [
  "sum",
  "distinct",
  "extremum",
  "ratio",
  "boolean",
  "sequence",
] as const satisfies readonly Aggregation[];

const UNATTRIBUTED_REASONS = [
  "locationHistoryOnly",
  "entryRemoved",
  "notPerEntry",
] as const satisfies readonly UnattributedReason[];

export const evidenceKindSchema = z.enum(EVIDENCE_KINDS);
export const evidenceDomainSchema = z.enum(EVIDENCE_DOMAINS);
export const aggregationSchema = z.enum(AGGREGATIONS);
export const unattributedReasonSchema = z.enum(UNATTRIBUTED_REASONS);

/** i18n KEY plus values — never a server-rendered string; see `EvidenceEntry.title`. */
const i18nLabelSchema = z.object({
  key: z.string(),
  values: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

/** A user-entered name (a hotel's own name) is not translatable — `{ text }` covers it. */
const textOrKeySchema = z.union([i18nLabelSchema, z.object({ text: z.string() })]);

export const evidenceScopeSchema = z.object({
  period: z.union([
    z.object({ kind: z.literal("allTime") }),
    z.object({ kind: z.literal("year"), year: z.number().int() }),
    z.object({ kind: z.literal("rolling12m") }),
  ]),
  domains: z.array(evidenceDomainSchema).optional(),
}) satisfies z.ZodType<EvidenceScope>;

export const evidenceMeasureSchema = z.object({
  kind: evidenceKindSchema,
  key: z.string(),
  aggregation: aggregationSchema,
  label: i18nLabelSchema,
  unit: z.string(),
  /** `null`, not 0 — a measure that cannot be derived is not a derived zero. */
  value: z.number().nullable(),
  scope: evidenceScopeSchema,
  /** `ratio` only: both sides, so the percentage can be explained rather than asserted. */
  numerator: z.number().optional(),
  denominator: z.number().optional(),
});

export const evidenceEntrySchema = z.object({
  domain: evidenceDomainSchema,
  /** Identity of the EVIDENCE — a stay id, a port-call id — not of `href`'s target. */
  id: z.string(),
  /** Where the user goes. A stay's target is its lodging, which may differ from `id`. */
  href: z.string().nullable(),
  title: textOrKeySchema,
  subtitle: textOrKeySchema.nullable(),
  /** The surface's own clock rule, with its precision kept. */
  date: z
    .object({
      value: z.string(),
      precision: z.enum(["day", "month", "year"]),
    })
    .nullable(),
  /** `sum` only, RAW and unrounded — rounding happens once, after aggregation, at the surface. */
  contribution: z.number().optional(),
  /** `distinct` only: the units this row witnesses ("DE", "MUC", "2026-04-02"). */
  credits: z.array(z.string()).optional(),
  /**
   * `distinct` only: a display name per credit key. Partial on purpose — a
   * key with no entry renders as itself, which is what an IATA code or an
   * ISO country already is. See `shared/evidence.ts` for the defect.
   */
  creditLabels: z.record(z.string(), z.string()).optional(),
});

export const evidenceResponseSchema = z.object({
  measure: evidenceMeasureSchema,
  entries: z.array(evidenceEntrySchema),
  returned: z.number().int(),
  /**
   * Known evidence beyond the current page — NOT unattributed. See
   * `shared/evidence.ts`'s `EvidenceResponse.omitted` for why the two are
   * kept apart.
   */
  omitted: z.object({
    count: z.number().int(),
    contribution: z.number().optional(),
    credits: z.number().optional(),
  }),
  /** An ARRAY: a count can be short a row for more than one reason at once. */
  unattributed: z.array(z.object({ count: z.number().int(), reason: unattributedReasonSchema })),
  page: z.object({ offset: z.number().int(), limit: z.number().int() }),
});

export type EvidenceMeasure = z.infer<typeof evidenceMeasureSchema>;
export type EvidenceEntry = z.infer<typeof evidenceEntrySchema>;
export type EvidenceResponse = z.infer<typeof evidenceResponseSchema>;

/**
 * These three types are declared TWICE on purpose (here, and as interfaces
 * in `shared/evidence.ts`) — the frontend cannot import a Zod schema, so
 * the shared module has to keep stating the shape for its mirror, while
 * this file's `z.infer` types are what the backend actually runs against.
 * Two declarations of one payload drift the first time a field is added
 * (the exact failure `Aggregation` used to have) unless something other
 * than a reader catches it.
 *
 * `Equals` is the conditional-type identity check, not the simpler
 * `[A] extends [B] ? [B] extends [A] ? true : never : never` form a first
 * pass at this used — that form is BLIND to optional-field drift: TS
 * lets a type with an extra optional property satisfy a mutual-extends
 * check against one without it, which describes most of this contract
 * (`numerator`, `denominator`, `contribution`, `credits`, `label.values`,
 * `scope.domains`, `subtitle`). A guard that is green exactly where the
 * drift actually happens is worse than no guard, because it looks like
 * one. Wrapping both sides in a distributive conditional over a bare type
 * parameter (`<T>() => T extends A ? 1 : 2`) makes optionality part of
 * what is compared, so this version fails on the same drift the first one
 * missed — proven by deliberately breaking it once (see the commit that
 * introduced this comment) before trusting it.
 */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const _measureMatchesContract: Equals<EvidenceMeasure, SharedEvidenceMeasure> = true;
const _entryMatchesContract: Equals<EvidenceEntry, SharedEvidenceEntry> = true;
const _responseMatchesContract: Equals<EvidenceResponse, SharedEvidenceResponse> = true;
void _measureMatchesContract;
void _entryMatchesContract;
void _responseMatchesContract;

/** Path params: `/evidence/:kind/:key`. An unknown `kind` is a 400 — the frontend never builds one. */
export const evidenceParamsSchema = z.object({
  kind: evidenceKindSchema,
  key: z.string().min(1),
});
export type EvidenceParams = z.infer<typeof evidenceParamsSchema>;

/** The first plausible year a logged trip could carry — commercial aviation's own start. */
const FIRST_PLAUSIBLE_TRAVEL_YEAR = 1900;

/**
 * Query params. `domains` arrives comma-separated (`flight,cruise`), the
 * same convention `routes/countryFlags.ts` uses for its `codes` list.
 *
 * `year` and `period` are checked in BOTH directions, with `.refine`
 * because Zod's own unions can't cross-validate two sibling fields:
 * missing when `period=year` (nothing to scope by), but also present
 * when `period` is anything else. The second direction matters as much
 * as the first — `?period=allTime&year=2026` used to pass validation and
 * have `evidenceScopeFromQuery` silently drop the year, which hides a
 * frontend bug exactly where every other case in this endpoint refuses
 * to: an unrecognised request should fail loudly, not look like a
 * working `allTime` query that happens to ignore one of its params.
 *
 * `year` is bounded rather than a bare `int()`: unbounded, `?period=year&
 * year=999999` passed validation and handed every resolver a year that
 * cannot exist to reconcile against, instead of failing at the boundary
 * where the mistake actually is. The upper bound is "next year", not a
 * fixed far-future constant, so a panel opened in December for a still-
 * forming year keeps working without this file ever needing a bump.
 */
export const evidenceQuerySchema = z
  .object({
    period: z.enum(["allTime", "year", "rolling12m"]).default("allTime"),
    year: z.coerce
      .number()
      .int()
      .min(FIRST_PLAUSIBLE_TRAVEL_YEAR)
      .max(new Date().getUTCFullYear() + 1)
      .optional(),
    domains: z
      .preprocess(
        (value) => (typeof value === "string" ? value.split(",").filter(Boolean) : value),
        z.array(evidenceDomainSchema)
      )
      .optional(),
    offset: z.coerce.number().int().min(0).default(0),
    /**
     * `EVIDENCE_PAGE_SIZE` is both the default AND the ceiling — a caller
     * can only ever ask for one page's worth in a single request, never a
     * bigger one. That is deliberate: the panel pages by scrolling
     * (`docs/superpowers/specs/2026-09-18-evidence-panel-design.md`,
     * "Paging, not a promise"), so there is no legitimate caller that
     * needs more than one page at once, and raising the ceiling would
     * only let a request re-open the unbounded-scan problem paging exists
     * to close.
     */
    limit: z.coerce.number().int().min(1).max(EVIDENCE_PAGE_SIZE).default(EVIDENCE_PAGE_SIZE),
  })
  .refine((query) => query.period !== "year" || query.year !== undefined, {
    message: "year is required when period=year",
    path: ["year"],
  })
  .refine((query) => query.period === "year" || query.year === undefined, {
    message: "year is only valid when period=year",
    path: ["year"],
  });
export type EvidenceQuery = z.infer<typeof evidenceQuerySchema>;

/** Builds the `EvidenceScope` a resolver receives out of a validated query. */
export function evidenceScopeFromQuery(query: EvidenceQuery): EvidenceScope {
  const period =
    query.period === "year" ? { kind: "year" as const, year: query.year! } : { kind: query.period };
  return query.domains ? { period, domains: query.domains } : { period };
}
