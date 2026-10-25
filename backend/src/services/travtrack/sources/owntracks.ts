import { z } from "../../../schemas/zod";
import { acceptedInstant } from "../classify";

/**
 * OwnTracks messages as TravTrack points (TravTrack plan E9). The app posts in
 * HTTP mode one message, an array of queued ones, or nothing at all, and
 * resends whatever got an error status — so nothing about the BODY is ever a
 * refusal: a location becomes a point, every other `_type` (`transition`,
 * `lwt`, `waypoint`, `encrypted`, …) is ignored even when it carries a
 * position, and a malformed location is counted. The points then go through
 * the one ingest (zone → deleted range → duplicate), which judges each again.
 *
 * Field by field: `tst` (seconds) → `t`, `acc` → accuracy (m), `alt` →
 * altitude (m), `vel` (km/h) → speed (m/s), `cog` → course (°). A negative
 * `acc`, `vel` or `cog` is the app's "unknown" and becomes null. A `tst`
 * outside the years the ingest accepts makes the message invalid.
 */

const finite = z.number();

const locationSchema = z
  .object({
    _type: z.literal("location"),
    tst: z.number().int().positive(),
    lat: finite,
    lon: finite,
    acc: finite.optional(),
    alt: finite.optional(),
    vel: finite.optional(),
    cog: finite.optional(),
  })
  .passthrough();

const typed = z.object({ _type: z.string().max(40) }).passthrough();

/** A non-negative reading, or null for the app's "unknown". */
const known = (v: number | undefined): number | null => (v === undefined || v < 0 ? null : v);

export type MappedOwnTracks = {
  points: Record<string, unknown>[];
  /** Messages the body held. */
  messages: number;
  /** Messages that are not locations: nothing to store. */
  ignored: number;
  /** Locations that could not be read. */
  invalid: number;
};

function messagesOf(body: unknown): unknown[] {
  if (body === undefined || body === null) return [];
  if (Array.isArray(body)) return body;
  // An empty POST arrives as `{}` from the JSON parser.
  if (typeof body === "object" && Object.keys(body).length === 0) return [];
  return [body];
}

export function mapOwnTracks(body: unknown): MappedOwnTracks {
  const messages = messagesOf(body);
  const out: MappedOwnTracks = { points: [], messages: messages.length, ignored: 0, invalid: 0 };
  for (const message of messages) {
    const head = typed.safeParse(message);
    if (head.success && head.data._type !== "location") {
      out.ignored += 1;
      continue;
    }
    const loc = locationSchema.safeParse(message);
    if (!loc.success) {
      out.invalid += 1;
      continue;
    }
    const m = loc.data;
    // Checked before `toISOString`, which throws on a tst no Date can hold —
    // and one throw would have failed the whole batch on every resend.
    if (!acceptedInstant(m.tst * 1000)) {
      out.invalid += 1;
      continue;
    }
    const vel = known(m.vel);
    out.points.push({
      id: `${m.tst}:${m.lat}:${m.lon}`,
      t: new Date(m.tst * 1000).toISOString(),
      lat: m.lat,
      lon: m.lon,
      accuracy: known(m.acc),
      altitude: m.alt ?? null,
      speed: vel === null ? null : vel / 3.6,
      course: known(m.cog),
      purpose: "everyday",
    });
  }
  return out;
}
