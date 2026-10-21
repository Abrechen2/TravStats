/**
 * The public half both carriers of a trip's facts read: the `.travstats` file (`format.ts`) and
 * the trip-share wire between servers (`services/sharing/federation/wire/`). One definition, so
 * file and wire cannot drift on what a position, a zone or a catalogue reference is (spec
 * 2026-10-20 §4: "the per-entity wire schemas and the `.travstats` schemas share one public-half
 * definition"). The wire has no private half at all; the file's private half stays in
 * `format.ts`.
 *
 * Catalogue rows travel by their natural keys — a port by UN/LOCODE, a ship by IMO number — with
 * name and position, never by this server's autoincrement id, which names nothing on another
 * server and says more about this one than either carrier needs to.
 */
import { z } from "../../../schemas/zod";
import { isValidZone } from "../../../shared/time/zonedParts";

export const lat = z.number().min(-90).max(90);
export const lon = z.number().min(-180).max(180);
/** A zone is stored and later computed with — one this runtime cannot read is refused here. */
export const requiredZone = z.string().max(64).refine(isValidZone, "unknown time zone");
export const zone = requiredZone.nullable();

/** A port: matched by UN/LOCODE where the catalogue has it, otherwise kept by name. */
export const portRef = z
  .object({
    unlocode: z.string().max(200).nullable(),
    name: z.string().max(200),
    country: z.string().max(200).nullable(),
    lat,
    lon,
  })
  .strict();
export type PortRef = z.infer<typeof portRef>;

/** A ship: matched by IMO number; a ship the catalogue lacks keeps its name. */
export const shipRef = z
  .object({
    name: z.string().max(200),
    imo: z.string().max(200).nullable(),
    cruiseLine: z.string().max(200),
  })
  .strict();
export type ShipRef = z.infer<typeof shipRef>;
