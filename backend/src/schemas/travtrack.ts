import { z } from "./zod";
import { MAX_GAPS } from "../services/travtrack/limits";

/**
 * What a client sends to TravTrack and asks of it (TravTrack plan T3; ported
 * from the archived location history, spec 2026-10-20 §3.2, §10.2). The
 * envelope is validated here; each point is checked on its own in
 * `services/travtrack/classify.ts`, because one bad point gets an outcome of
 * its own instead of failing the whole batch. Gaps are read whole in
 * `services/travtrack/gaps.ts`: a bad gap refuses the upload.
 */

/** Points per upload (§10.2: one transaction per request). */
export const LOCATION_MAX_POINTS = 5000;

/** Bytes, checked from `Content-Length` before the points are read. ~200 bytes a point. */
export const LOCATION_MAX_BODY_BYTES = 2 * 1024 * 1024;

export const travTrackUploadSchema = z
  .object({
    /** The client's id for this upload — a retry sends the same id and the same content. */
    uploadId: z.string().trim().min(1).max(200),
    /**
     * The points as the client holds them. Each is an object; its fields are
     * read by the classifier, which gives an invalid one its own outcome.
     */
    points: z.array(z.record(z.string(), z.unknown())).max(LOCATION_MAX_POINTS),
    /** What the phone could not record: `{ from, to, reason }`, read in `gaps.ts`. */
    gaps: z.array(z.record(z.string(), z.unknown())).max(MAX_GAPS).optional(),
  })
  .refine(
    (b) => b.points.length > 0 || (b.gaps?.length ?? 0) > 0,
    "An upload carries at least one point or one gap"
  );

export type TravTrackUpload = z.infer<typeof travTrackUploadSchema>;

/** One page of `GET /travtrack/points`. */
export const LOCATION_PAGE_MAX = 5000;

export const travTrackPointsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).describe("Inclusive instant"),
  to: z.string().datetime({ offset: true }).describe("Exclusive instant"),
  /** `<t ms>:<seq>` of the last point of the previous page. */
  cursor: z
    .string()
    .regex(/^\d{1,15}:\d{1,19}$/)
    .optional()
    .describe("Continue after this point (`nextCursor` of the previous page)"),
  limit: z.coerce.number().int().min(1).max(LOCATION_PAGE_MAX).default(1000),
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The four ways to name a span: two instants, or two days on the profile clock. */
const rangeFields = {
  from: z.string().datetime({ offset: true }).optional().describe("Inclusive instant"),
  to: z.string().datetime({ offset: true }).optional().describe("Exclusive instant"),
  fromDay: day.optional().describe("First day, inclusive, on the profile's clock"),
  toDay: day.optional().describe("Last day, inclusive, on the profile's clock"),
};

type RangeFields = {
  from?: string;
  to?: string;
  fromDay?: string;
  toDay?: string;
};

const oneForm = (q: RangeFields) =>
  (q.from !== undefined &&
    q.to !== undefined &&
    q.fromDay === undefined &&
    q.toDay === undefined) ||
  (q.fromDay !== undefined && q.toDay !== undefined && q.from === undefined && q.to === undefined);

const inOrder = (q: RangeFields) =>
  q.from !== undefined && q.to !== undefined
    ? Date.parse(q.from) < Date.parse(q.to)
    : (q.fromDay ?? "") <= (q.toDay ?? "");

/**
 * A span to delete: two instants, or two calendar days (both inclusive) on the
 * account's profile clock — what a person picks in a form.
 */
export const travTrackRangeQuerySchema = z
  .object(rangeFields)
  .refine(oneForm, "Either `from` and `to`, or `fromDay` and `toDay`")
  .refine(inOrder, "The span must not end before it starts");

export type TravTrackRangeQuery = z.infer<typeof travTrackRangeQuerySchema>;

/** The summary of everything, or of one span named like a delete (its preview). */
export const travTrackSummaryQuerySchema = z
  .object(rangeFields)
  .refine(
    (q) => Object.values(q).every((v) => v === undefined) || oneForm(q),
    "No span, or `from` and `to`, or `fromDay` and `toDay`"
  )
  .refine((q) => Object.values(q).every((v) => v === undefined) || inOrder(q), {
    message: "The span must not end before it starts",
  });

/** One day of the history on the profile clock (`GET /travtrack/day`). */
export const travTrackDayQuerySchema = z.object({
  date: day.describe("The day, `YYYY-MM-DD`, on the profile's clock"),
});

/** The longest span one export answers. */
export const TRAVTRACK_EXPORT_MAX_DAYS = 366;

export const travTrackExportQuerySchema = z
  .object({
    ...rangeFields,
    format: z.enum(["gpx", "json"]).default("json").describe("GPX 1.1 or TravTrack's JSON"),
    cursor: z
      .string()
      .regex(/^\d{1,15}:\d{1,19}$/)
      .optional()
      .describe("Continue after this point (`X-TravTrack-Cursor` of the previous part)"),
  })
  .refine(oneForm, "Either `from` and `to`, or `fromDay` and `toDay`")
  .refine(inOrder, "The span must not end before it starts");

/** A privacy zone (§3.6): a circle, named so the user knows it again. */
const zoneFields = {
  name: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Metres: a flat to a small town. */
  radiusM: z.number().int().min(50).max(5000),
};

/** `deleteStoredPoints`: the user has seen how many stored positions the zone deletes and agreed. */
export const travTrackZoneCreateSchema = z.object({
  ...zoneFields,
  deleteStoredPoints: z.boolean().default(false),
});

export const travTrackZoneUpdateSchema = z
  .object({
    name: zoneFields.name.optional(),
    lat: zoneFields.lat.optional(),
    lon: zoneFields.lon.optional(),
    radiusM: zoneFields.radiusM.optional(),
    deleteStoredPoints: z.boolean().default(false),
  })
  .refine((b) => (b.lat === undefined) === (b.lon === undefined), "`lat` and `lon` move together");

/**
 * `GET /travtrack/explored` (plan L1): the map's box as `west,south,east,north`
 * in degrees. West may exceed east — a box across the antimeridian. Any other
 * query field (a client's `zoom`) is ignored: the answer has one resolution.
 */
export const travTrackExploredQuerySchema = z.object({
  bbox: z
    .string()
    .describe("`west,south,east,north` in degrees; west > east crosses the antimeridian")
    .transform((raw, ctx) => {
      const parts = raw.split(",").map((p) => (p.trim() === "" ? NaN : Number(p)));
      const [west, south, east, north] = parts;
      const lonOk = (v: number) => Number.isFinite(v) && v >= -180 && v <= 180;
      const latOk = (v: number) => Number.isFinite(v) && v >= -90 && v <= 90;
      if (
        parts.length !== 4 ||
        !lonOk(west) ||
        !lonOk(east) ||
        !latOk(south) ||
        !latOk(north) ||
        south > north
      ) {
        ctx.addIssue({ code: "custom", message: "bbox must be west,south,east,north" });
        return z.NEVER;
      }
      return { west, south, east, north };
    }),
});
