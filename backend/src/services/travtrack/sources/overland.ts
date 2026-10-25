import { z } from "../../../schemas/zod";
import { LOCATION_MAX_POINTS } from "../../../schemas/travtrack";

/**
 * Overland batches as TravTrack points (TravTrack plan E9). The app posts
 * `{ locations: Feature<Point>[] }` and deletes the batch from the phone on a
 * `{ "result": "ok" }` answer alone, so a body that is not a batch at all is a
 * 400 (the phone keeps it), while one unreadable feature inside a batch is
 * counted and the rest is stored — otherwise one bad fix would wedge the
 * queue forever.
 *
 * `coordinates` are `[lon, lat]`; `properties.timestamp` is ISO 8601, often
 * with a `-0700`-style offset, read as `-07:00`; a time without an offset is
 * not an instant and the feature is invalid. `horizontal_accuracy` and `speed`
 * are negative when unknown (→ null), `motion[0]` is the activity.
 */

const finite = z.number();

const featureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([finite, finite]).rest(finite),
  }),
  properties: z
    .object({
      timestamp: z.string().max(40),
      altitude: finite.nullish(),
      speed: finite.nullish(),
      horizontal_accuracy: finite.nullish(),
      course: finite.nullish(),
      motion: z.array(z.string().max(40)).max(10).nullish(),
    })
    .passthrough(),
});

/** The envelope; each feature is read on its own in `mapOverland`. */
export const overlandBodySchema = z
  .object({ locations: z.array(z.unknown()).max(LOCATION_MAX_POINTS) })
  .passthrough();

export type OverlandBody = z.infer<typeof overlandBodySchema>;

/** `…-0700` → `…-07:00`; every other form unchanged. */
export const normaliseOffset = (ts: string): string =>
  ts.replace(/([+-])(\d{2})(\d{2})$/, "$1$2:$3");

const HAS_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

/** Overland's activity words in TravTrack's motion vocabulary. */
const MOTION: Record<string, string> = {
  driving: "automotive",
  automotive: "automotive",
  walking: "walking",
  running: "running",
  cycling: "cycling",
  stationary: "stationary",
};

const known = (v: number | null | undefined): number | null =>
  v === undefined || v === null || v < 0 ? null : v;

export type MappedOverland = {
  points: Record<string, unknown>[];
  /** Features that could not be read as a timed Point. */
  invalid: number;
};

export function mapOverland(body: OverlandBody): MappedOverland {
  const out: MappedOverland = { points: [], invalid: 0 };
  for (const raw of body.locations) {
    const f = featureSchema.safeParse(raw);
    const timestamp = f.success ? normaliseOffset(f.data.properties.timestamp) : "";
    if (!f.success || !HAS_OFFSET.test(timestamp)) {
      out.invalid += 1;
      continue;
    }
    const [lon, lat] = f.data.geometry.coordinates;
    const p = f.data.properties;
    out.points.push({
      id: `${timestamp}:${lon}:${lat}`,
      t: timestamp,
      lat,
      lon,
      accuracy: known(p.horizontal_accuracy),
      altitude: p.altitude ?? null,
      speed: known(p.speed),
      course: known(p.course),
      motion: MOTION[p.motion?.[0] ?? ""] ?? null,
      purpose: "everyday",
    });
  }
  return out;
}
