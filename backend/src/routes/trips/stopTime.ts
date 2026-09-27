import { prisma } from "../../db";
import type { AuthRequest } from "../../middleware/auth";
import { TimeShapeRequiredError } from "../../shared/time/errors";
import { fakeUtcOf, instantOfFakeUtc, resolveTimeField } from "../../shared/time/resolveInput";
import type { TimeFieldInput } from "../../shared/time/timeInput";
import type { TimePrecision } from "../../shared/time/wire";
import { zoneOf } from "../../shared/time/zoneOf";

/**
 * A trip stop's times on the time model (ADR 0002 phase 2 dual-write).
 *
 * `startDate`/`endDate` keep their old meaning — the stop's wall clock stored
 * as if it were UTC — and the new columns carry the instants, the zone the
 * stop is in and a precision. The zone is the stop's own coordinates, else
 * the entry it wraps (a flight's departure, a stay's hotel, a place); with
 * neither there is no clock to read, and the values stay wall clocks with
 * precision `unknown` rather than being read as UTC (D2).
 */

type Place = {
  lat: number | null;
  lon: number | null;
  domain: string | null;
  sourceId: string | null;
};

/** The zone of the entry a stop wraps, where it names one the user owns. */
async function zoneOfWrapped(place: Place, userId: string): Promise<string | null> {
  const { domain, sourceId } = place;
  if (!domain || !sourceId) return null;
  if (domain === "flight") {
    const f = await prisma.flight.findFirst({
      where: { id: sourceId, userId },
      select: { depTimezone: true, depLat: true, depLon: true },
    });
    return f ? zoneOf({ catalogueZone: f.depTimezone, lat: f.depLat, lon: f.depLon }) : null;
  }
  if (domain === "train" || domain === "rail") {
    const r = await prisma.railJourney.findFirst({
      where: { id: sourceId, userId },
      select: { depTimezone: true, depLat: true, depLon: true },
    });
    return r ? zoneOf({ catalogueZone: r.depTimezone, lat: r.depLat, lon: r.depLon }) : null;
  }
  if (domain === "hotel" || domain === "lodging") {
    const s = await prisma.lodgingStay.findFirst({
      where: { id: sourceId, userId },
      select: { stayZone: true, lodging: { select: { lat: true, lon: true } } },
    });
    return s ? zoneOf({ catalogueZone: s.stayZone, lat: s.lodging.lat, lon: s.lodging.lon }) : null;
  }
  if (domain === "cruise") {
    const c = await prisma.cruise.findFirst({
      where: { id: sourceId, userId },
      select: { departurePort: { select: { timezone: true, lat: true, lon: true } } },
    });
    const port = c?.departurePort;
    return port ? zoneOf({ catalogueZone: port.timezone, lat: port.lat, lon: port.lon }) : null;
  }
  const p = await prisma.place.findFirst({
    where: { id: sourceId, userId },
    select: { lat: true, lon: true },
  });
  return p ? zoneOf(p) : null;
}

/** The zone a stop's clock is read in: its coordinates, else the entry it wraps. */
export async function stopZoneOf(place: Place, userId: string): Promise<string | null> {
  return zoneOf(place) ?? (await zoneOfWrapped(place, userId));
}

interface Resolved {
  legacy: Date;
  utc: Date | null;
  precision: TimePrecision;
}

async function resolveOne(
  input: TimeFieldInput,
  zone: string | null,
  req: AuthRequest,
  field: string
): Promise<Resolved> {
  const namesItsZone = input.kind === "local" && (input.zone || input.placeRef);
  if (zone || namesItsZone) {
    const r = await resolveTimeField(input, {
      field,
      placeZone: () => zone,
      userId: req.userId!,
      legacyFakeUtc: true,
      viaToken: Boolean(req.apiToken),
    });
    return { legacy: fakeUtcOf(r), utc: r.utc, precision: r.precision };
  }
  // No clock to read the value on: keep what can be kept, precision unknown.
  if (input.kind === "instant") {
    if (input.bareZ && !req.apiToken) throw new TimeShapeRequiredError(field);
    return { legacy: input.utc, utc: input.utc, precision: "minute" };
  }
  if (input.kind === "date") {
    return { legacy: new Date(`${input.date}T00:00:00.000Z`), utc: null, precision: "unknown" };
  }
  if (input.kind === "wallClockString" && !req.apiToken) throw new TimeShapeRequiredError(field);
  return { legacy: new Date(`${input.local}Z`), utc: null, precision: "unknown" };
}

export interface StopTimeWrite {
  startDate?: Date | null;
  endDate?: Date | null;
  timeColumns: {
    startUtc: Date | null;
    endUtc: Date | null;
    stopZone: string | null;
    precision: TimePrecision | null;
  };
}

const RANK: Record<TimePrecision, number> = { unknown: 4, minute: 3, day: 2, month: 1, year: 0 };

/**
 * The legacy values and new columns for a stop write. `sent` holds the
 * fields the request carried (`undefined` = not sent, `null` = cleared);
 * `stored` is the row before the write (null on create), whose unsent values
 * are re-read in the (possibly new) zone.
 */
export async function tripStopTimes(
  sent: { startDate?: TimeFieldInput | null; endDate?: TimeFieldInput | null },
  place: Place,
  stored: { startDate: Date | null; endDate: Date | null; precision: string | null } | null,
  req: AuthRequest
): Promise<StopTimeWrite> {
  const zone = await stopZoneOf(place, req.userId!);
  const one = async (key: "startDate" | "endDate"): Promise<Resolved | null> => {
    const value = sent[key];
    if (value === null) return null;
    if (value !== undefined) return resolveOne(value, zone, req, key);
    const legacy = stored?.[key] ?? null;
    if (!legacy) return null;
    const precision = (stored?.precision as TimePrecision | null) ?? "minute";
    return zone
      ? {
          legacy,
          utc: instantOfFakeUtc(legacy, zone),
          precision: precision === "unknown" ? "minute" : precision,
        }
      : { legacy, utc: null, precision: "unknown" };
  };
  const start = await one("startDate");
  const end = await one("endDate");
  const present = [start, end].filter((r): r is Resolved => r !== null);
  const precision = present.length
    ? present.reduce<TimePrecision>(
        (worst, r) => (RANK[r.precision] > RANK[worst] ? r.precision : worst),
        "year"
      )
    : null;
  return {
    ...(sent.startDate !== undefined ? { startDate: start?.legacy ?? null } : {}),
    ...(sent.endDate !== undefined ? { endDate: end?.legacy ?? null } : {}),
    timeColumns: {
      startUtc: start?.utc ?? null,
      endUtc: end?.utc ?? null,
      stopZone: zone,
      precision,
    },
  };
}
