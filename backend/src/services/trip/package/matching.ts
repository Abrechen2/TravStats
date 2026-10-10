/**
 * What a package document already has in the logbook — the lookups behind
 * the proposal's create / attach / skip decisions. Read-only.
 *
 * The rules, in the order the plan states them:
 *   trip     a booking whose reference equals the document's (case-insensitive)
 *            and that sits on a trip; else the ONE trip overlapping the span
 *   flights  the provenance key (`flightExternalRef`), else the same flight
 *            number departing on the same local day
 *   stays    the same house (`pickHouse`: name AND place) with the same
 *            check-in day
 *   cruise   the provenance key (`cruiseExternalRef`) or the booking reference
 *
 * A second document of the same booking (invoice, then travel documents)
 * therefore finds what the first one created and attaches to it.
 */
import { prisma } from "../../../db";
import { getCachedAirports } from "../../airportCache";
import { cruiseExternalRef, flightExternalRef } from "../../importProvenance";
import {
  houseVerdict,
  normalisedLodgingName,
  type HouseIdentity,
} from "../../sharing/facts/lodgingStay";
import { soleOverlappingTrip } from "../../rental/rentalLinks";
import { FLIGHT_CLOCK_SELECT, withDepartureClock } from "../../stats/departureClock";
import { flightDepartureDay } from "./flightClock";
import { addDays, type PackageContract, type PackageFlight } from "./contract";
import { airportByIata, resolveCities, type CityResolution } from "./airportByCity";
import type { PackageChoices, ProposalEndpoint } from "./types";

// ------------------------------------------------------------------ airports

export interface EndpointContext {
  cities: Map<string, CityResolution>;
  /** IATA codes the catalogue knows, out of those the document or the reviewer named. */
  known: Set<string>;
  choices: Record<string, string>;
}

export async function endpointContext(
  contract: PackageContract,
  choices: PackageChoices
): Promise<EndpointContext> {
  const cityNames = contract.flights.flatMap((f) => [
    ...(!f.depIata && f.depCity ? [f.depCity] : []),
    ...(!f.arrIata && f.arrCity ? [f.arrCity] : []),
  ]);
  const chosen = choices.airports ?? {};
  const named = [
    ...contract.flights.flatMap((f) => [f.depIata, f.arrIata]),
    ...Object.values(chosen),
  ].filter((c): c is string => Boolean(c));
  const catalogue = named.length > 0 ? await getCachedAirports(named) : new Map();
  const known = new Set(named.filter((c) => catalogue.has(c.toUpperCase())));
  // A pick the catalogue does not hold is not a pick — it stays unresolved.
  for (const code of Object.values(chosen)) {
    if (!known.has(code) && (await airportByIata(code))) known.add(code);
  }
  return { cities: await resolveCities(cityNames), known, choices: chosen };
}

export function resolveEndpoint(
  iata: string | null | undefined,
  city: string | null | undefined,
  ctx: EndpointContext
): ProposalEndpoint {
  if (iata) {
    return { iata, city: city ?? null, status: ctx.known.has(iata) ? "given" : "unknown" };
  }
  const name = city ?? "";
  const picked = ctx.choices[name];
  if (picked && ctx.known.has(picked)) return { iata: picked, city: name, status: "chosen" };
  const found = ctx.cities.get(name);
  if (found?.kind === "resolved") {
    return { iata: found.airport.iata, city: name, status: "resolved" };
  }
  if (found?.kind === "ambiguous") {
    return { iata: null, city: name, status: "ambiguous", candidates: found.candidates };
  }
  return { iata: null, city: name, status: "unknown" };
}

// ------------------------------------------------------------------ trip + booking

export interface ExistingBooking {
  id: string;
  tripId: string | null;
  price: number | null;
  currency: string | null;
}

export async function bookingByReference(
  userId: string,
  reference: string
): Promise<ExistingBooking | null> {
  // Oldest first: when a reference was recorded twice, the first record is
  // the one the rest of the logbook already points at.
  return prisma.booking.findFirst({
    where: { userId, pnr: { equals: reference, mode: "insensitive" } },
    orderBy: [{ tripId: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: { id: true, tripId: true, price: true, currency: true },
  });
}

export async function tripById(
  userId: string,
  id: string
): Promise<{ id: string; name: string } | null> {
  return prisma.trip.findFirst({ where: { id, userId }, select: { id: true, name: true } });
}

export async function tripOverlapping(
  userId: string,
  span: { first: string; last: string } | null
): Promise<string | null> {
  return span ? soleOverlappingTrip(userId, span) : null;
}

// ------------------------------------------------------------------ flights

export interface ExistingEntry {
  id: string;
  tripId: string | null;
  bookingId: string | null;
}

/** "ET707" and the spaced "ET 707" a hand-typed row may hold. */
function numberSpellings(flightNumber: string): string[] {
  const m = /^([A-Z0-9]{2})(\d+[A-Z]?)$/.exec(flightNumber);
  return m ? [flightNumber, `${m[1]} ${m[2]}`] : [flightNumber];
}

export async function existingFlight(
  userId: string,
  flight: PackageFlight,
  depIata: string | null,
  arrIata: string | null
): Promise<ExistingEntry | null> {
  const select = { id: true, tripId: true, bookingId: true } as const;
  const ref =
    depIata && arrIata
      ? flightExternalRef({
          flightNumber: flight.flightNumber,
          departureLocal: `${flight.date}T${flight.depTime ?? "12:00"}`,
          depIata,
          arrIata,
        })
      : null;
  if (ref) {
    const byRef = await prisma.flight.findFirst({ where: { userId, externalRef: ref }, select });
    if (byRef) return byRef;
  }
  // The same number on the same LOCAL day of departure. The window is wide in
  // UTC (a day either side) and narrowed on each row's own clock.
  const from = new Date(`${addDays(flight.date, -1)}T00:00:00Z`);
  const to = new Date(`${addDays(flight.date, 2)}T00:00:00Z`);
  const rows = await prisma.flight.findMany({
    where: {
      userId,
      OR: numberSpellings(flight.flightNumber).map((n) => ({
        flightNumber: { equals: n, mode: "insensitive" as const },
      })),
      departureTime: { gte: from, lt: to },
    },
    select: { ...select, departureTime: true, ...FLIGHT_CLOCK_SELECT },
    take: 10,
  });
  // Each row on its own clock (`flightDepartureDay`) — the semantics too, not
  // only the zone: a LEGACY_FAKE_UTC row read as an instant fell on the wrong
  // day and the flight was created twice (forgejo#279). A row that stored no
  // zone is read in its airport's catalogue zone, like every statistic.
  const sameDay = (await withDepartureClock(rows)).find(
    (r) => r.departureTime && flightDepartureDay(r.departureTime, r) === flight.date
  );
  return sameDay ? { id: sameDay.id, tripId: sameDay.tripId, bookingId: sameDay.bookingId } : null;
}

// ------------------------------------------------------------------ stays

/** A house as an import names it: a name, and whatever place it states. */
export type IncomingHouse = Pick<HouseIdentity, "name"> & Partial<Omit<HouseIdentity, "name">>;

const asHouse = (h: IncomingHouse): HouseIdentity => ({
  name: h.name,
  city: h.city ?? null,
  country: h.country ?? null,
  isoCountryCode: h.isoCountryCode ?? null,
  lat: h.lat ?? null,
  lon: h.lon ?? null,
});

/**
 * Which of `candidates` (oldest first) an incoming house is — the sharing
 * rule (`houseVerdict`, name AND place), so a package, a `.travstats` file and
 * a shared trip agree on what "the same hotel" means (forgejo#277).
 *
 *   - candidates the place data proves to be the house: the one already
 *     holding a stay on `preferStay`, else the oldest
 *   - none proven, and exactly ONE same-named candidate whose place cannot be
 *     compared (a side has no coordinates and no city): that one — nothing
 *     contradicts it, nothing competes with it, and a re-import of a
 *     place-less package stays idempotent
 *   - otherwise none: a second "Hotel Central" in another city, or two
 *     candidates nobody can tell apart, is never resolved by age
 */
export function pickHouse<T extends HouseIdentity & { id: string }>(
  candidates: T[],
  incoming: IncomingHouse,
  preferStay: (candidate: T) => boolean = () => false
): T | null {
  const house = asHouse(incoming);
  const same = candidates.filter((c) => houseVerdict(c, house) === "same");
  if (same.length > 0) return same.find(preferStay) ?? same[0];
  const named = candidates.filter(
    (c) => normalisedLodgingName(c.name) === normalisedLodgingName(house.name)
  );
  return named.length === 1 && houseVerdict(named[0], house) === "unknown" ? named[0] : null;
}

export interface ResolvedHouse {
  /** The user's lodging this house is, or null — a new one is created. */
  lodgingId: string | null;
  /** That lodging's stay checking in on the asked day, if any. */
  stay: ExistingEntry | null;
}

export interface LodgingIndex {
  resolve(house: IncomingHouse, checkInDay: string | null): ResolvedHouse;
}

const dayOfDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

type CandidateHouse = HouseIdentity & { id: string; stays: Map<string, ExistingEntry> };

export async function lodgingIndex(userId: string, houses: IncomingHouse[]): Promise<LodgingIndex> {
  const wanted = new Set(houses.map((h) => normalisedLodgingName(h.name)));
  const byName = new Map<string, CandidateHouse[]>();
  if (wanted.size > 0) {
    const rows = await prisma.lodging.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        city: true,
        country: true,
        isoCountryCode: true,
        lat: true,
        lon: true,
        stays: {
          select: { id: true, tripId: true, bookingId: true, checkIn: true, checkInDate: true },
        },
      },
    });
    for (const { stays, ...row } of rows) {
      const key = normalisedLodgingName(row.name);
      if (!wanted.has(key)) continue;
      const byDay = new Map<string, ExistingEntry>();
      for (const s of stays) {
        const day = dayOfDate(s.checkInDate) ?? dayOfDate(s.checkIn);
        if (day) byDay.set(day, { id: s.id, tripId: s.tripId, bookingId: s.bookingId });
      }
      byName.set(key, [...(byName.get(key) ?? []), { ...row, stays: byDay }]);
    }
  }
  return {
    resolve(house, checkInDay) {
      const candidates = byName.get(normalisedLodgingName(house.name)) ?? [];
      const hit = pickHouse(candidates, house, (c) =>
        Boolean(checkInDay && c.stays.has(checkInDay))
      );
      return {
        lodgingId: hit?.id ?? null,
        stay: hit && checkInDay ? (hit.stays.get(checkInDay) ?? null) : null,
      };
    },
  };
}

// ------------------------------------------------------------------ cruise

export function packageCruiseRef(contract: PackageContract): string | null {
  return cruiseExternalRef({
    bookingReference: contract.bookingReference,
    shipNameOverride: contract.cruiseShip ?? null,
    startDate: contract.cruiseStart ?? null,
  });
}

export async function existingCruise(
  userId: string,
  contract: PackageContract
): Promise<ExistingEntry | null> {
  return existingCruiseByRef(userId, {
    externalRef: packageCruiseRef(contract),
    bookingReference: contract.bookingReference,
  });
}

/** The cruise rule on its own: the provenance key, or the booking reference. */
export async function existingCruiseByRef(
  userId: string,
  ref: { externalRef: string | null; bookingReference: string | null }
): Promise<ExistingEntry | null> {
  const or = [
    ...(ref.externalRef ? [{ externalRef: ref.externalRef }] : []),
    ...(ref.bookingReference
      ? [{ bookingReference: { equals: ref.bookingReference, mode: "insensitive" as const } }]
      : []),
  ];
  if (or.length === 0) return null;
  return prisma.cruise.findFirst({
    where: { userId, OR: or },
    select: { id: true, tripId: true, bookingId: true },
  });
}
