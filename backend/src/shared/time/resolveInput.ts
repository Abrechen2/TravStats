import { prisma } from "../../db";
import { TimeShapeRequiredError, TzUnresolvedError, LocalTimeNonexistentError } from "./errors";
import { toInstant, toLocal } from "./instant";
import type { TimeFieldInput } from "./timeInput";
import type { PlaceRefKind, TimePrecision } from "./wire";
import { resolveZone, zoneOf } from "./zoneOf";

/**
 * Turns an inbound time field (`timeInput.ts`) into what phase 2 stores
 * (ADR 0002, plan "Refinement to ADR D7"): the real instant, the zone of the
 * place, the place's wall clock and the precision. The legacy column keeps
 * its old meaning and is derived from the same result (`fakeUtcOf`), so the
 * two can never disagree about what was typed.
 */

export interface ResolvedTime {
  utc: Date;
  /** Null only for a machine instant at a place with no zone. */
  zone: string | null;
  /** `YYYY-MM-DDTHH:mm:ss` at the place; null exactly when `zone` is. */
  local: string | null;
  precision: TimePrecision;
  ambiguous: boolean;
}

export interface ResolveContext {
  /** The request field, reported with every refusal. */
  field: string;
  /** Zone of the place the entity names; null when it has none. */
  placeZone: () => string | null;
  /** Needed to resolve a `placeRef` of kind `place` (user-scoped). */
  userId: string;
  /**
   * The field used to hold the place's wall clock as fake UTC. A bare `Z`
   * from a browser session is then a cached pre-deploy bundle, not an instant.
   */
  legacyFakeUtc?: boolean;
  /** The request came with a personal access token (the Companion, a script). */
  viaToken: boolean;
}

type PlaceRef = { kind: PlaceRefKind; id: string };

function intId(ref: PlaceRef, field: string): number {
  const id = Number(ref.id);
  if (!Number.isInteger(id))
    throw new TzUnresolvedError(`${ref.kind} ${ref.id} is not an id`, field);
  return id;
}

/** The zone of a catalogue row or user place named by reference. */
export async function zoneOfPlaceRef(
  ref: PlaceRef,
  userId: string,
  field: string
): Promise<string> {
  let place: { timezone?: string | null; lat: number; lon: number } | null = null;
  if (ref.kind === "airport") {
    const code = ref.id.toUpperCase();
    place = await prisma.airport.findFirst({
      where: { OR: [{ iata: code }, { icao: code }], isClosed: false },
      select: { timezone: true, lat: true, lon: true },
    });
  } else if (ref.kind === "railStation") {
    place = await prisma.railStation.findUnique({
      where: { id: intId(ref, field) },
      select: { timezone: true, lat: true, lon: true },
    });
  } else if (ref.kind === "port") {
    place = await prisma.port.findUnique({
      where: { id: intId(ref, field) },
      select: { timezone: true, lat: true, lon: true },
    });
  } else {
    place = await prisma.place.findFirst({
      where: { id: ref.id, userId },
      select: { lat: true, lon: true },
    });
  }
  if (!place) throw new TzUnresolvedError(`${ref.kind} ${ref.id} not found`, field);
  try {
    return resolveZone({ catalogueZone: place.timezone, lat: place.lat, lon: place.lon }).zone;
  } catch (error) {
    if (error instanceof TzUnresolvedError) throw new TzUnresolvedError(error.message, field);
    throw error;
  }
}

function requirePlaceZone(ctx: ResolveContext): string {
  const zone = ctx.placeZone();
  if (!zone) throw new TzUnresolvedError("the place has no zone", ctx.field);
  return zone;
}

/**
 * The stored form of one inbound time. Refuses — never guesses:
 * a typed wall clock in a gap (`LOCAL_TIME_NONEXISTENT`), a place without a
 * zone for a typed time (`TZ_UNRESOLVED`), a bare `Z` from a browser session
 * on a formerly fake-UTC field (`TIME_SHAPE_REQUIRED`).
 */
export async function resolveTimeField(
  input: TimeFieldInput,
  ctx: ResolveContext
): Promise<ResolvedTime> {
  if (input.kind === "local") {
    const zone =
      input.zone ??
      (input.placeRef
        ? await zoneOfPlaceRef(input.placeRef, ctx.userId, ctx.field)
        : requirePlaceZone(ctx));
    let result;
    try {
      result = toInstant(input.local, zone, { fold: input.fold, origin: "typed" });
    } catch (error) {
      if (error instanceof LocalTimeNonexistentError) {
        throw new LocalTimeNonexistentError(input.local, zone, ctx.field);
      }
      throw error;
    }
    return {
      utc: result.utc,
      zone,
      local: toLocal(result.utc, zone).local,
      precision: "minute",
      ambiguous: result.ambiguous,
    };
  }

  if (input.kind === "wallClockString") {
    // Only the Companion relays these (see `tokenWallClockString`); from a
    // browser it is the shape the host used to read in its own zone.
    if (!ctx.viaToken) throw new TimeShapeRequiredError(ctx.field);
    const zone = requirePlaceZone(ctx);
    const { utc, ambiguous } = toInstant(input.local, zone, { origin: "machine" });
    return { utc, zone, local: toLocal(utc, zone).local, precision: "minute", ambiguous };
  }

  if (input.kind === "date") {
    const zone = requirePlaceZone(ctx);
    // The day's start at the place: a machine reading, so a zone whose
    // midnight falls in a gap (Samoa 2011, some Levant zones) is not refused.
    const { utc } = toInstant(`${input.date}T00:00`, zone, { origin: "machine" });
    return { utc, zone, local: `${input.date}T00:00:00`, precision: "day", ambiguous: false };
  }

  if (ctx.legacyFakeUtc && input.bareZ && !ctx.viaToken) {
    throw new TimeShapeRequiredError(ctx.field);
  }
  const zone = ctx.placeZone();
  return {
    utc: input.utc,
    zone,
    local: zone ? toLocal(input.utc, zone).local : null,
    precision: "minute",
    ambiguous: false,
  };
}

/**
 * The legacy fake-UTC value for a resolved time: the place's wall clock
 * written as if it were UTC — what the web always stored in these columns.
 * Without a zone the instant is all there is; it is stored as it came, as a
 * token client's write always was.
 */
export function fakeUtcOf(resolved: ResolvedTime): Date {
  return resolved.local ? new Date(`${resolved.local}Z`) : resolved.utc;
}

/** `fakeUtcOf` for an optional value. */
export function fakeUtcOrNull(resolved: ResolvedTime | null): Date | null {
  return resolved ? fakeUtcOf(resolved) : null;
}

/**
 * The real instant a legacy fake-UTC value names at a zone — for writers that
 * still produce the legacy shape (importers, seeds, parsers). A machine
 * reading: an import must not fail on the hour a year that does not exist.
 */
export function instantOfFakeUtc(fakeUtc: Date, zone: string): Date {
  return toInstant(fakeUtc.toISOString().slice(0, 19), zone, { origin: "machine" }).utc;
}

/** The zone of a coordinate pair, or null without one (a lookup that cannot run still throws). */
export function zoneOfCoordinates(
  lat: number | null | undefined,
  lon: number | null | undefined
): string | null {
  return zoneOf({ lat, lon });
}
