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
  "trip",
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
 * (the exact failure `Aggregation` used to have, fixed one commit before
 * this one) unless something other than a reader catches it. `Exact` turns
 * that drift into a `tsc --noEmit` failure: a field added here and
 * forgotten in `shared/evidence.ts` is a payload the frontend's type says
 * does not exist, and the reverse is a promise the backend never keeps —
 * either direction fails one of these three lines.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _measureMatchesContract: Exact<EvidenceMeasure, SharedEvidenceMeasure> = true;
const _entryMatchesContract: Exact<EvidenceEntry, SharedEvidenceEntry> = true;
const _responseMatchesContract: Exact<EvidenceResponse, SharedEvidenceResponse> = true;
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
 * `year` is required exactly when `period=year` — checked with `.refine`
 * because Zod's own unions can't cross-validate two sibling fields.
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
  });
export type EvidenceQuery = z.infer<typeof evidenceQuerySchema>;

/** Builds the `EvidenceScope` a resolver receives out of a validated query. */
export function evidenceScopeFromQuery(query: EvidenceQuery): EvidenceScope {
  const period =
    query.period === "year" ? { kind: "year" as const, year: query.year! } : { kind: query.period };
  return query.domains ? { period, domains: query.domains } : { period };
}
