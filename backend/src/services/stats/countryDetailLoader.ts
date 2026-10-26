/**
 * Everything the country drill-down needs from the database, read once.
 *
 * The same split — and the same reason — as `./passportLoader.ts`:
 * `buildCountryDetail` is a pure function so it can be tested against
 * hand-written rows, and this is the file that goes and gets those rows. It
 * moved out of `routes/stats.ts` when the track evidence of spec §8 needed a
 * sixth query, and that route is a 2,500-line file the size ratchet has frozen
 * — so the choice was between a loader beside the one the passport already has,
 * and one more query in the largest file in the repository.
 *
 * Nothing here decides anything. Which house proves a country, which record
 * outranks which, whether a track is a connection — all of that is
 * `services/stats/countryDetail.ts` and `shared/countryEvidence.ts`.
 *
 * The five curated sources are read exactly as `passportLoader` reads them, on
 * purpose: a row and the page behind it must agree, and the only way to
 * guarantee that is to ask the same questions.
 */

import { prisma } from "../../db";
import { buildPassport } from "./passport";
import { countableFlightWhere } from "../../shared/flightCounting";
import { buildCountryDetail, manualCountryDetail, type CountryDetail } from "./countryDetail";
import {
  loadAirportCountries,
  loadHomeCountries,
  loadHomeIatas,
  passportAirportCodes,
  placeVisitAt,
} from "./passportLoader";
import { countableCruiseWhere } from "../../shared/cruiseCounting";
import { classifyVisit } from "../../shared/placeCounting";
import { loadRoadtripStations } from "./roadtripEvidenceLoader";
import { loadRailEnds } from "./railEvidenceLoader";
import { loadBusEnds } from "./busEvidence";
import { loadFerryEnds } from "./ferryEvidence";
import { loadVisibleDomains } from "../domainVisibility";
import { FLIGHT_CLOCK_SELECT, withDepartureClock } from "./departureClock";
import { applyCountryOverrides } from "./countryOverrides";
import { listCountryOverrides } from "./countryOverrideStore";
import { departureDayOf } from "../../utils/stats/departureClock";
import { isoCountryCode } from "../../utils/continents";
import { flightDay } from "./flightEvidence";
import {
  anyDayInYear,
  dayInYear,
  portCallDays,
  scopeLodgingStays,
  scopeOverrides,
} from "./passportYear";

/** Every argument `buildCountryDetail` takes after the country code, in its order. */
export type CountryDetailInputs =
  Parameters<typeof buildCountryDetail> extends [string, ...infer Rest] ? Rest : never;

/**
 * @param code the requested country, an ISO alpha-2 code or an English name
 * @returns null when nothing evidences it and no verdict of the user's puts it
 *   in the passport — the route's 404
 */
/**
 * The drill-down's records limited to one calendar year — the same per-source
 * cut `buildPassport` makes under a year (`./passportYear.ts`), so the page
 * opened from a year's row shows that year's records and no other. Undated
 * records belong to no year and are left out.
 */
export function scopeCountryDetailInputs(
  inputs: CountryDetailInputs,
  year: number,
  now: Date = new Date()
): CountryDetailInputs {
  const [
    flights,
    airports,
    home,
    ports,
    places,
    lodgings,
    track,
    limit,
    stations,
    rail,
    bus,
    ferry,
  ] = inputs;
  const endsIn = (ends: typeof rail = []) => ends.filter((e) => anyDayInYear(e.days, year));
  return [
    flights.filter((f) => dayInYear(flightDay(f), year)),
    airports,
    home,
    (ports ?? []).filter((call) => anyDayInYear(portCallDays(call), year)),
    (places ?? []).filter((v) => dayInYear(v.at?.toISOString().slice(0, 10), year)),
    scopeLodgingStays(lodgings ?? [], year, now),
    (track ?? []).filter((row) => dayInYear(row.date, year)),
    limit,
    (stations ?? []).filter((s) => anyDayInYear(s.days, year)),
    endsIn(rail),
    endsIn(bus),
    endsIn(ferry),
  ];
}

/**
 * @param options.year only that calendar year's records (companion-redesign
 *   C4); a country with none answers null — the 404 — even if other years
 *   have some. Omitted: the lifetime page, exactly as before.
 */
export async function loadCountryDetail(
  userId: string,
  code: string,
  options: { year?: number } = {}
): Promise<CountryDetail | null> {
  const { year } = options;
  const wanted = isoCountryCode(code);
  if (!wanted) return null;
  const inputs = await loadCountryDetailInputs(userId);
  const scoped = year === undefined ? inputs : scopeCountryDetailInputs(inputs, year);
  const evidenced = buildCountryDetail(code, ...scoped);
  // Read before deciding on a 404: a `visited` or `ground` verdict lists a
  // country with no record behind it, and its row must open (forgejo#308).
  // Under a year only a verdict dated in it can open an otherwise empty page.
  const overrides = await listCountryOverrides(userId);
  const manual = overrides.some(
    (o) =>
      o.verdict !== "excluded" &&
      o.countryCode.toUpperCase() === wanted &&
      (year === undefined || dayInYear(o.day, year))
  );
  if (!evidenced && !manual) return null;
  const detail = evidenced ?? manualCountryDetail(wanted);
  const [flights, airports, home, ports, places, lodgings, , , stations, rail, bus, ferry] = inputs;
  const today = new Date().toISOString().slice(0, 10);
  const homeCountries = await loadHomeCountries(userId, today);
  // Reuse the same fold and loaded records. No second database scan or local
  // rule — and the user's overrides (forgejo#308) through the same function
  // `loadPassport` applies them with, so a row and its page agree. The year
  // only decides `isNew`, which this page does not read.
  const automatic = buildPassport(
    flights,
    airports,
    [...(home ?? [])],
    new Date(),
    ports,
    places,
    lodgings,
    undefined,
    [],
    stations,
    rail,
    undefined,
    bus,
    homeCountries,
    ferry,
    // The whole account goes in and the year is cut inside, exactly as
    // `loadPassport` does, so the flags below match the year's passport row.
    year
  );
  const passport =
    year === undefined
      ? applyCountryOverrides(automatic, overrides, Number(today.slice(0, 4)))
      : applyCountryOverrides(
          automatic,
          scopeOverrides(overrides, year, new Set(automatic.countries.map((c) => c.code))),
          year
        );
  const row = passport.countries.find((country) => country.code === detail.code);
  const excluded = passport.excludedCountries.find((country) => country.code === detail.code);
  return {
    ...detail,
    // A year page carries no other year: a stay over New Year dates itself by
    // its check-out, which may fall in the next one.
    ...(year === undefined
      ? {}
      : {
          firstYear: detail.firstYear === null ? null : year,
          lastYear: detail.lastYear === null ? null : year,
        }),
    groundPresence: row?.groundPresence ?? false,
    visited: row?.visited ?? false,
    // An excluded country is decided, not unclear: the user took it out.
    visitUncertain: row?.visitUncertain ?? excluded === undefined,
    visitUncertainReasons: row?.visitUncertainReasons ?? [],
    override:
      row?.override ??
      (excluded ? { verdict: "excluded" as const, note: excluded.note, day: excluded.day } : null),
  };
}

/**
 * The rows every country's drill-down is built from, read ONCE for the whole
 * account. Split out of `loadCountryDetail` so the passport's evidence
 * (`services/evidence/metricEvidencePassport.ts`, forgejo#132 items 5 and 6)
 * can ask the drill-down's own question for every country without reading the
 * database once per country — and without a second copy of these queries,
 * which is how a row and its evidence would start to disagree.
 *
 * The timeline limit is left at its default; a caller that needs every row
 * replaces that one argument.
 */
export async function loadCountryDetailInputs(userId: string): Promise<CountryDetailInputs> {
  // One clock for the whole load, so two evidence sources cannot disagree
  // about whether a visit has happened yet.
  const now = new Date();

  const flightRows = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: {
      id: true,
      flightNumber: true,
      ...FLIGHT_CLOCK_SELECT,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      departureTime: true,
      status: true,
    },
  });
  // Each flight's day at its departure airport — what the passport row files it
  // under (`passportLoader`), so the page behind the row agrees (forgejo#273).
  const flights = (await withDepartureClock(flightRows)).map((f) => ({
    ...f,
    localDay: departureDayOf(f),
  }));

  // The same sources the passport counts, so the row and the page can only ever
  // agree.
  const [
    airportCountries,
    portCalls,
    places,
    lodgings,
    countryDays,
    homeIatas,
    stations,
    rail,
    bus,
    ferry,
  ] = await Promise.all([
    loadAirportCountries(passportAirportCodes(flights)),
    prisma.cruiseStop.findMany({
      where: {
        cruise: { userId, ...countableCruiseWhere() },
        port: { isNot: null },
      },
      select: {
        cruiseId: true,
        arrivalTime: true,
        departureTime: true,
        date: true,
        port: { select: { name: true, country: true } },
      },
    }),
    prisma.place.findMany({
      where: { userId, visited: true, isoCountryCode: { not: null } },
      select: {
        id: true,
        name: true,
        isoCountryCode: true,
        countryVisitKind: true,
        visits: { select: { visitedAt: true, visitedAtUtc: true, visitedZone: true } },
      },
    }),
    // The fourth source, and the one the owner's instruction is about: a house
    // proves a country, so the page behind that row must be able to open it.
    // `visited: false` is excluded — a bookmarked house is not a visit — and
    // the stays travel UNFILTERED with their status, because `lodgingEvidence`
    // owns which of them count and a house whose only stay was filtered away
    // would arrive as a house with no stay, which counts as a night.
    prisma.lodging.findMany({
      where: { userId, visited: true, isoCountryCode: { not: null } },
      select: {
        id: true,
        name: true,
        isoCountryCode: true,
        countryVisitKind: true,
        // datePrecision + nights: a MONTH placeholder spans a whole month while
        // attesting a few nights, and must not be walked into exact days.
        stays: {
          select: {
            status: true,
            checkIn: true,
            checkOut: true,
            datePrecision: true,
            nights: true,
          },
        },
      },
    }),
    // The fifth: measured presence (spec §8). Handed over unfiltered like
    // every source above it, so the one place that decides which rows belong
    // to a country is `buildCountryDetail` — narrowing it here would put a
    // second copy of that join in the loader, which is the drift the shared
    // module exists to end. One row per country per day, so the whole set is
    // a few thousand rows even for a decade of history.
    prisma.countryDay.findMany({
      where: { userId },
      select: { date: true, countryCode: true, pointCount: true },
    }),
    loadHomeIatas(userId),
    // The sixth: roadtrip stations, from the loader the passport reads too.
    loadRoadtripStations(userId, now),
    // The seventh: train station ends, from the loader the passport reads too.
    loadRailEnds(userId),
    // The eighth: bus terminal ends, only while bus is visible — the
    // passport's own cut (forgejo#265).
    loadVisibleDomains(userId).then((visible) =>
      visible.includes("bus") ? loadBusEnds(userId) : []
    ),
    // The ninth: ferry port ends, only while ferry is visible.
    loadVisibleDomains(userId).then((visible) =>
      visible.includes("ferry") ? loadFerryEnds(userId) : []
    ),
  ]);

  return [
    flights,
    airportCountries,
    homeIatas,
    portCalls.map((stop) => ({
      cruiseId: stop.cruiseId,
      portName: stop.port?.name ?? null,
      country: stop.port?.country ?? null,
      at: stop.arrivalTime ?? stop.date,
      // Read only by the year cut, which dates a call by its days in port as
      // the passport does; the page itself still dates a call by its arrival.
      until: stop.departureTime,
    })),
    // Only visits that have HAPPENED. A booking for 2099 is not evidence of
    // ever having been in a country, and passing it made the detail page agree
    // with a passport that had already gone wrong the same way (AUD-085). A
    // place explicitly marked visited keeps its undated confirmation when only
    // future dates are recorded; those future dates never date the evidence.
    places.flatMap((place) => {
      const happened = place.visits.filter((v) => classifyVisit(v, now) === "visited");
      return happened.length > 0
        ? happened.map((v) => ({
            placeId: place.id,
            name: place.name,
            isoCountryCode: place.isoCountryCode,
            countryVisitKind: place.countryVisitKind,
            at: placeVisitAt(v),
          }))
        : [
            {
              placeId: place.id,
              name: place.name,
              isoCountryCode: place.isoCountryCode,
              countryVisitKind: place.countryVisitKind,
              at: null,
            },
          ];
    }),
    lodgings.map((lodging) => ({
      lodgingId: lodging.id,
      name: lodging.name,
      isoCountryCode: lodging.isoCountryCode,
      countryVisitKind: lodging.countryVisitKind,
      stays: lodging.stays,
    })),
    countryDays.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      countryCode: row.countryCode,
      pointCount: row.pointCount,
    })),
    undefined,
    stations,
    rail,
    bus,
    ferry,
  ];
}
