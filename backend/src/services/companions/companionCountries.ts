import { prisma } from "../../db";
import { countableFlightWhere } from "../../shared/flightCounting";
import { countableCruiseWhere } from "../../shared/cruiseCounting";
import { localDay } from "../../shared/time/instant";
import { profileZoneOf } from "../../shared/time/profileZone";
import { countryThresholdFor } from "../countryThresholdResolver";
import { buildPassport } from "../stats/passport";
import {
  PASSPORT_FLIGHT_SELECT,
  loadAirportCountries,
  loadHomeCountries,
  loadHomeIatas,
  passportAirportCodes,
  passportFlightsOf,
} from "../stats/passportLoader";
import { loadRailEnds } from "../stats/railEvidenceLoader";
import { loadBusEnds } from "../stats/busEvidence";
import { loadFerryEnds } from "../stats/ferryEvidence";
import { applyCountryOverrides } from "../stats/countryOverrides";
import { listCountryOverrides } from "../stats/countryOverrideStore";
import type { TogetherEntry } from "./companionTogether";

/**
 * "Länder zusammen": the countries the passport's VISITED rule (forgejo#299)
 * proves from the entries two people shared — the same `buildPassport` the
 * passport and the overview's "Länder besucht" read, handed only the flights,
 * port calls, rides and stays the companion was on. A stay goes in with its
 * house, and that house carries ONLY the shared stays: a house with no stay
 * at all counts by itself, so a house the companion never stayed in must not
 * reach the fold. A connection both sat through is
 * still a connection; a port call is a visit (owner rulings 2026-10-16).
 *
 * The user's own verdicts (forgejo#308) apply to the countries those entries
 * prove, but a country the user ADDED by hand is no shared entry and is never
 * credited to a companion.
 *
 * Abstention: a companion whose shared entries include no kind that can prove
 * a country (only trips and rentals) gets `null`, not 0 — nothing was asked.
 */
const PROVING_KINDS = new Set(["flight", "cruise", "lodging", "rail", "bus", "ferry"]);

export interface CompanionCountries {
  /** ISO codes, sorted; null when no shared entry could prove a country. */
  codes: string[] | null;
}

type Inputs = Awaited<ReturnType<typeof loadInputs>>;

async function loadInputs(userId: string, entries: readonly TogetherEntry[]) {
  const idsOf = (kind: string) =>
    new Set(entries.filter((e) => e.kind === kind).map((e) => e.entry.id));
  const flightIds = idsOf("flight");
  const cruiseIds = idsOf("cruise");
  const stayIds = idsOf("lodging");
  const [flights, portCalls, rail, bus, ferry, lodgings] = await Promise.all([
    flightIds.size === 0
      ? []
      : prisma.flight.findMany({
          where: { userId, id: { in: [...flightIds] }, ...countableFlightWhere() },
          select: { ...PASSPORT_FLIGHT_SELECT, id: true },
        }),
    cruiseIds.size === 0
      ? []
      : prisma.cruiseStop.findMany({
          where: {
            cruise: { userId, id: { in: [...cruiseIds] }, ...countableCruiseWhere() },
            port: { isNot: null },
          },
          select: {
            cruiseId: true,
            arrivalTime: true,
            departureTime: true,
            date: true,
            port: { select: { country: true } },
          },
        }),
    idsOf("rail").size === 0 ? [] : loadRailEnds(userId),
    idsOf("bus").size === 0 ? [] : loadBusEnds(userId),
    idsOf("ferry").size === 0 ? [] : loadFerryEnds(userId),
    stayIds.size === 0
      ? []
      : prisma.lodging.findMany({
          // The passport's own cut: `visited: false` is a bookmark, not a visit.
          where: { userId, visited: true, isoCountryCode: { not: null } },
          select: {
            isoCountryCode: true,
            countryVisitKind: true,
            city: true,
            stays: {
              where: { id: { in: [...stayIds] } },
              select: {
                id: true,
                status: true,
                checkIn: true,
                checkOut: true,
                datePrecision: true,
                nights: true,
              },
            },
          },
        }),
  ]);
  const now = new Date();
  const [passportFlights, airportCountries, homeIatas, threshold, profile, overrides] =
    await Promise.all([
      passportFlightsOf(flights),
      loadAirportCountries(passportAirportCodes(flights)),
      loadHomeIatas(userId),
      countryThresholdFor(userId),
      profileZoneOf(userId),
      listCountryOverrides(userId),
    ]);
  const homeCountries = await loadHomeCountries(userId, localDay(now, profile.zone));
  return {
    now,
    passportFlights,
    airportCountries,
    homeIatas,
    threshold,
    profile,
    overrides,
    homeCountries,
    portCalls,
    rail,
    bus,
    ferry,
    lodgings,
  };
}

/** The visited countries of ONE companion's shared entries, from inputs loaded for all. */
function foldOne(inputs: Inputs, entries: readonly TogetherEntry[]): CompanionCountries {
  if (!entries.some((e) => PROVING_KINDS.has(e.kind))) return { codes: null };
  const ids = (kind: string) =>
    new Set(entries.filter((e) => e.kind === kind).map((e) => e.entry.id));
  const flightIds = ids("flight");
  const cruiseIds = ids("cruise");
  const railIds = ids("rail");
  const busIds = ids("bus");
  const ferryIds = ids("ferry");
  const stayIds = ids("lodging");
  const lodgings = inputs.lodgings.flatMap((house) => {
    const stays = house.stays.filter((stay) => stayIds.has(stay.id));
    return stays.length > 0 ? [{ ...house, stays }] : [];
  });
  const automatic = buildPassport(
    inputs.passportFlights.filter((f) => flightIds.has(f.id)),
    inputs.airportCountries,
    inputs.homeIatas,
    inputs.now,
    inputs.portCalls
      .filter((stop) => cruiseIds.has(stop.cruiseId))
      .map((stop) => ({
        country: stop.port?.country ?? null,
        at: stop.arrivalTime ?? stop.date,
        until: stop.departureTime,
      })),
    [],
    lodgings,
    inputs.threshold,
    [],
    [],
    inputs.rail.filter((end) => railIds.has(end.rideId)),
    inputs.profile.zone,
    inputs.bus.filter((end) => busIds.has(end.rideId)),
    inputs.homeCountries,
    inputs.ferry.filter((end) => ferryIds.has(end.rideId))
  );
  const known = new Set(automatic.countries.map((row) => row.code));
  const passport = applyCountryOverrides(
    automatic,
    inputs.overrides.filter((o) => known.has(o.countryCode.toUpperCase())),
    Number(localDay(inputs.now, inputs.profile.zone).slice(0, 4))
  );
  return {
    codes: passport.countries
      .filter((row) => row.visited)
      .map((row) => row.code)
      .sort(),
  };
}

/** Countries together, per companion id, with one read of the shared inputs. */
export async function countriesTogether(
  userId: string,
  byCompanion: ReadonlyMap<string, readonly TogetherEntry[]>
): Promise<Map<string, CompanionCountries>> {
  const all = [...byCompanion.values()].flat();
  const inputs = await loadInputs(userId, all);
  return new Map([...byCompanion].map(([id, entries]) => [id, foldOne(inputs, entries)]));
}
