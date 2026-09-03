import { z } from "zod";

/**
 * The vocabulary of the data-quality inbox.
 *
 * Owner's decision, 2026-09-02 ("Unplausible Sachen markieren und in den
 * Posteingang", design §3.5): a record that contradicts itself is written, then
 * flagged, and the question is queued. It is never refused, and the flag never
 * changes a number.
 *
 * The wording rule that governs every string a user reads about a flag:
 * **a flag is a question, not a verdict.** A third-party geocoder does not get a
 * veto over the user's own data, so nothing here may be phrased as "this record
 * is wrong". The vocabulary is deliberately neutral — `kind` names what
 * DISAGREED, not who was right.
 *
 * `DataQualityFlag.entityType`, `.kind` and `.status` are plain string columns.
 * This file is the constraint, which is what lets a later check — a flight one,
 * a cruise one — arrive without a migration.
 */

/**
 * What a flag is about.
 *
 * `country` is not a row: `undated_country_evidence` is a finding about a
 * COUNTRY, not about any one house. One flag per country is the honest grain —
 * an undated house is perfectly normal, and a country resting on nothing else is
 * the finding. The records that proved it travel in `details.records`, so §3.4's
 * "one click away and editable" still holds.
 */
export const DATA_QUALITY_ENTITY_TYPES = ["lodging", "place", "country"] as const;
export const dataQualityEntityTypeSchema = z.enum(DATA_QUALITY_ENTITY_TYPES);
export type DataQualityEntityType = (typeof DATA_QUALITY_ENTITY_TYPES)[number];

/**
 * The entity types that ARE a row — everything except `country`.
 *
 * Kept apart from the full list because the distinction is load-bearing twice
 * over: a row has a name the user wrote and a page to edit it on, a country has
 * neither. See `flaggedRecordSchema` and `dataQualityFlagSubjectSchema`.
 */
export const DATA_QUALITY_RECORD_ENTITY_TYPES = ["lodging", "place"] as const;
export const dataQualityRecordEntityTypeSchema = z.enum(DATA_QUALITY_RECORD_ENTITY_TYPES);
export type DataQualityRecordEntityType = (typeof DATA_QUALITY_RECORD_ENTITY_TYPES)[number];

/** Which check fired. One member per check in `services/dataQuality/checks/`. */
export const DATA_QUALITY_FLAG_KINDS = [
  /** The geocoded country and the country written in the address text differ. */
  "address_country_mismatch",
  /** Every record naming this country carries no date at all. */
  "undated_country_evidence",
  /** A stay whose check-out precedes its check-in. */
  "stay_dates_reversed",
  /** The stored coordinates fall inside a different country than the one claimed. */
  "coordinates_outside_country",
] as const;
export const dataQualityFlagKindSchema = z.enum(DATA_QUALITY_FLAG_KINDS);
export type DataQualityFlagKind = (typeof DATA_QUALITY_FLAG_KINDS)[number];

/**
 * `resolved` and `dismissed` are NOT two spellings of "done".
 *
 * - `resolved` — "I have corrected the data." A re-run therefore re-opens it if
 *   the contradiction is still there, because otherwise clicking the button
 *   would be a way of hiding a fault rather than fixing one.
 * - `dismissed` — "This is not wrong, stop asking." A re-run never re-opens it.
 *   This is the escape hatch for a check that is right about the disagreement
 *   and wrong about the conclusion.
 */
export const DATA_QUALITY_FLAG_STATUSES = ["open", "resolved", "dismissed"] as const;
export const dataQualityFlagStatusSchema = z.enum(DATA_QUALITY_FLAG_STATUSES);
export type DataQualityFlagStatus = (typeof DATA_QUALITY_FLAG_STATUSES)[number];

/**
 * A ROW a flag points at, in the shape the UI needs to link to it.
 *
 * `entityType` is deliberately narrower than the flag's own: a country is not a
 * row, and this shape's whole contract is that `label` is **display text the
 * user wrote**. A country would have to put its ISO code there, and then `label`
 * would mean a name here and a code there — which is exactly the ambiguity
 * `dataQualityFlagSubjectSchema` below exists to remove.
 */
export const flaggedRecordSchema = z.object({
  entityType: dataQualityRecordEntityTypeSchema,
  entityId: z.string(),
  /** What to call it on screen. The user's own text, never a code. */
  label: z.string(),
});
export type FlaggedRecord = z.infer<typeof flaggedRecordSchema>;

/**
 * What a flag is ABOUT, named so the inbox can render it without a second
 * request (design §3.4).
 *
 * Two shapes, not one with a field that means two things. A row carries `label`
 * — the user's own text, ready to print. A country carries `countryCode` and no
 * label at all, because the server cannot produce one: the name is localised,
 * and the server does not know the reader's language.
 *
 * The single-shape version of this had a `country` subject put "CZ" in `label`
 * with a comment saying the UI localises it. That made `label` sometimes a name
 * and sometimes a code, and the first consumer to read it generically printed
 * "CZ" as a hotel name would have been read. A comment cannot stop that; a
 * missing field can.
 */
export const dataQualityFlagSubjectSchema = z.discriminatedUnion("entityType", [
  z.object({
    entityType: z.literal("lodging"),
    entityId: z.string(),
    label: z.string(),
  }),
  z.object({
    entityType: z.literal("place"),
    entityId: z.string(),
    label: z.string(),
  }),
  z.object({
    entityType: z.literal("country"),
    /** ISO 3166-1 alpha-2. The identity AND the whole payload — a country has no name here. */
    countryCode: z.string(),
  }),
]);
export type DataQualityFlagSubject = z.infer<typeof dataQualityFlagSubjectSchema>;

/**
 * What the geocoder said against what the address says.
 *
 * Both values travel, and neither is marked as the correct one — which is the
 * whole point. `addressCountryText` is the raw tail of the address so the user
 * can see what was read, not just what it was read as.
 */
export const addressCountryMismatchDetailsSchema = z.object({
  claimedCountryCode: z.string().nullable(),
  claimedCountryText: z.string().nullable(),
  addressCountryCode: z.string(),
  addressCountryText: z.string(),
  address: z.string(),
});

/** Which country, and every record that names it — all of them undated. */
export const undatedCountryEvidenceDetailsSchema = z.object({
  countryCode: z.string(),
  records: z.array(flaggedRecordSchema),
});

/**
 * Where the record says it is, against where its coordinates actually are.
 *
 * Both codes travel and neither is marked correct — the same trade the address
 * check makes. `lat`/`lon` come along so the user can see the point that was
 * tested rather than take the verdict on trust; a coordinate two degrees out is
 * a typo they will recognise instantly, and one that is right means the country
 * is what needs correcting.
 */
export const coordinatesOutsideCountryDetailsSchema = z.object({
  claimedCountryCode: z.string(),
  /** What the boundaries answered. Never null: an abstention is not a disagreement. */
  coordinateCountryCode: z.string(),
  lat: z.number(),
  lon: z.number(),
});

/** The offending stays of one lodging, with both dates as stored. */
export const stayDatesReversedDetailsSchema = z.object({
  stays: z.array(
    z.object({
      stayId: z.string(),
      checkIn: z.string(),
      checkOut: z.string(),
    })
  ),
});

/**
 * The `kind` → `details` pairing, stated once and enforced everywhere.
 *
 * This used to be a bare `z.union` of the three detail shapes, which validated
 * that `details` was SOME known shape and never that it was the shape `kind`
 * promises. `stay_dates_reversed` carrying an address-mismatch payload passed.
 * Nothing downstream could then switch on `kind` and read `details` as the
 * matching type without asserting something the payload did not say, so the
 * frontend grew three runtime guards to re-derive by hand what the schema had
 * thrown away.
 *
 * A discriminated union cannot be wrong about the pairing, which is what the
 * house rule ("Zod at every boundary") asks for here. The three variants are
 * declared once and reused by the view schema below, so the pairing has exactly
 * one home.
 *
 * **`kind` is NOT part of `details`.** It stays a sibling column, so nothing
 * about the stored jsonb changes — a discriminator written INTO the payload
 * would make every existing flag read as `updated` on the next sweep.
 */
const addressCountryMismatchPayload = z.object({
  kind: z.literal("address_country_mismatch"),
  details: addressCountryMismatchDetailsSchema,
});
const undatedCountryEvidencePayload = z.object({
  kind: z.literal("undated_country_evidence"),
  details: undatedCountryEvidenceDetailsSchema,
});
const stayDatesReversedPayload = z.object({
  kind: z.literal("stay_dates_reversed"),
  details: stayDatesReversedDetailsSchema,
});
const coordinatesOutsideCountryPayload = z.object({
  kind: z.literal("coordinates_outside_country"),
  details: coordinatesOutsideCountryDetailsSchema,
});

/**
 * A `kind` with the `details` that kind implies, and nothing else.
 *
 * The boundary a stored row crosses on its way out: `flagService.toView` parses
 * `{kind, details}` through this, so a row whose two columns disagree is refused
 * where the data enters rather than shipped to a client that has to re-check it.
 */
export const dataQualityFlagPayloadSchema = z.discriminatedUnion("kind", [
  addressCountryMismatchPayload,
  undatedCountryEvidencePayload,
  stayDatesReversedPayload,
  coordinatesOutsideCountryPayload,
]);
export type DataQualityFlagPayload = z.infer<typeof dataQualityFlagPayloadSchema>;

/** Every detail shape, as a union. Only useful where `kind` is already known. */
export type DataQualityFlagDetails = DataQualityFlagPayload["details"];

/**
 * `DATA_QUALITY_FLAG_KINDS` and the union above are ONE list, checked as one.
 *
 * They are written twice because each has a job the other cannot do — the enum
 * is what `?kind=` filters on, the union is what `details` is validated against.
 * Two hand-kept lists drift, and this drift would be quiet in the worst way: a
 * kind added to the enum alone is filterable and unservable at the same time,
 * so the inbox would answer an empty list rather than an error. This line makes
 * that a compile failure in the file where the omission happened.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _kindsCoverEveryVariant: MutuallyAssignable<
  DataQualityFlagKind,
  DataQualityFlagPayload["kind"]
> = true;
void _kindsCoverEveryVariant;

/**
 * Everything a flag carries that does not depend on its `kind`.
 *
 * `subject` is the subject as it exists right now, so the inbox can name and
 * link it without a second request (design §3.4). A flag whose subject has been
 * deleted is not returned at all — there is nothing left to look at — and the
 * next run resolves it.
 */
const dataQualityFlagBase = z.object({
  id: z.string().uuid(),
  entityType: dataQualityEntityTypeSchema,
  entityId: z.string(),
  status: dataQualityFlagStatusSchema,
  subject: dataQualityFlagSubjectSchema,
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});

/** One flag as the API returns it. */
export const dataQualityFlagSchema = z.discriminatedUnion("kind", [
  addressCountryMismatchPayload.merge(dataQualityFlagBase),
  undatedCountryEvidencePayload.merge(dataQualityFlagBase),
  stayDatesReversedPayload.merge(dataQualityFlagBase),
  coordinatesOutsideCountryPayload.merge(dataQualityFlagBase),
]);
export type DataQualityFlagView = z.infer<typeof dataQualityFlagSchema>;

/**
 * `status` defaults to `open` because the inbox is a list of open questions.
 * `all` exists so a user can see what they already answered without a second
 * endpoint.
 */
export const listDataQualityFlagsQuerySchema = z.object({
  status: z.enum([...DATA_QUALITY_FLAG_STATUSES, "all"]).default("open"),
  kind: dataQualityFlagKindSchema.optional(),
});

export const dataQualityFlagIdParamSchema = z.object({
  id: z.string().uuid(),
});
