import { prisma } from "../../db";
import type { EvidenceEntry } from "../../schemas/evidence";
import type { DomainKey } from "../../shared/domains";
import { countableFlightWhere } from "../../shared/flightCounting";
import { isCountableCruiseStatus } from "../../shared/cruiseCounting";
import { classifyLodging, classifyStay } from "../../shared/lodgingCounting";
import { classifyPlace, classifyVisit } from "../../shared/placeCounting";
import { toCountryCode } from "../../shared/countryEvidence";
import { crossDomainDayKey } from "../../shared/crossDomainCounting";
import { lodgingCountryKey } from "../../utils/stats/lodgingCountryKey";
import { localWallClockOf, type FlightTimeSemantics } from "../../utils/timezone";
import { getCachedAirports } from "../airportCache";
import { flightEvidenceEntry } from "./entryMappers";
import {
  cruiseEvidenceEntry,
  placeEvidenceEntry,
  railEvidenceEntry,
  roadtripEvidenceEntry,
  stayEvidenceEntry,
} from "./entryMappersDomains";
import {
  countableRailWhere,
  railCountries,
  railDayKeys,
  railYear,
} from "../../shared/railCounting";
import { getCountryResolver } from "../geo/countryFromCoordinates";
import { stationCountries } from "../roadtrip/roadtripSummary";

/**
 * The rows behind the three `CrossDomainKpis` numbers, per domain, as the
 * four client adapters in `frontend/src/lib/stats/domain-stats/` derive them.
 *
 * The union arithmetic is shared (`shared/crossDomainCounting.ts`); what is
 * NOT shared is where each domain's contribution comes from, because the two
 * sides read different sources. The frontend folds four rollup endpoints
 * (`/stats/countries`, `/stats/cruise`, `/lodging/stats`, and the raw places
 * for POI, which has no rollup); this file folds the rows themselves. Each
 * derivation below therefore names the adapter it mirrors and the rule that
 * adapter applies, because a rule invented here would move the panel's
 * number away from the tile's.
 *
 * Three quirks that look like mistakes and are the adapters' own:
 *
 *  1. **A domain's lifetime event count is not the sum of its years.** A
 *     flight with no departure time is one experience and belongs to no
 *     year; so is a stay whose dates are unknown. The adapters count both in
 *     `totalEvents` and in no `yearlyEvents` bucket, and so does this.
 *  2. **Countries are not always attributed to the same row as events.** A
 *     lodging the user entered but never recorded a stay at still proves its
 *     country (owner, 2026-09-02, country-counting design §1.4), and a place
 *     marked visited proves its country with no visit row at all. Country
 *     rows are therefore the LODGING and the PLACE, while event rows are the
 *     STAY and the VISIT.
 *  3. **A cruise's days span both sides of New Year; its event does not.**
 *     The experience counts in the year it STARTED — "the year I cruised" is
 *     the year it began — while every day it covered lands in its own
 *     calendar year.
 */

/** A row that is one experience, on the days it covered. */
export interface CrossDomainEventRow {
  domain: DomainKey;
  /** Identity only: the resolver adds `contribution` or `credits`. */
  entry: EvidenceEntry;
  /** The year this EVENT is filed under; null where the row carries no date. */
  year: number | null;
  /** `YYYY-MM-DD` keys this row was active on, each on its own domain's clock. */
  dayKeys: string[];
}

/** A row that proves a country — not always the same row as an event. */
export interface CrossDomainCountryRow {
  domain: DomainKey;
  entry: EvidenceEntry;
  /** ISO 3166-1 alpha-2 codes. */
  countries: string[];
  /** The years this row proves them IN. Empty means lifetime only. */
  years: number[];
}

export interface CrossDomainPopulation {
  events: CrossDomainEventRow[];
  countryRows: CrossDomainCountryRow[];
}

/** `flightEvidenceEntry` always fills `contribution`; the resolver decides it here. */
function withoutContribution(entry: EvidenceEntry): EvidenceEntry {
  const { contribution: _unused, ...rest } = entry;
  return rest;
}

function utcDayKey(date: Date): string {
  return crossDomainDayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every calendar day from `start` to `end` INCLUSIVE — the cruise adapter's own span. */
function inclusiveUtcDays(start: Date, end: Date): string[] {
  const days: string[] = [];
  let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cursor <= last) {
    days.push(utcDayKey(new Date(cursor)));
    cursor += DAY_MS;
  }
  return days;
}

/**
 * A stay's nights as days: from check-in to check-out EXCLUSIVE, because a
 * night belongs to the day it starts on and the check-out day is a departure
 * day. A same-day stay still marks its one day — `markActiveDays` in
 * `lodgingStatsAdapter.ts` states both halves of this.
 */
function stayDays(checkIn: Date, checkOut: Date): string[] {
  const days: string[] = [];
  let cursor = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
  const end = Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate());
  if (cursor >= end) return [utcDayKey(new Date(cursor))];
  while (cursor < end) {
    days.push(utcDayKey(new Date(cursor)));
    cursor += DAY_MS;
  }
  return days;
}

/**
 * `adaptFlight` + `GET /stats/countries`. The year and the active day are
 * read on the clock at the DEPARTURE airport, not in UTC and not in the
 * reader's zone — otherwise the same flight falls into different years for
 * different readers (#266). Both country ends count (#233).
 */
async function loadFlights(userId: string): Promise<CrossDomainPopulation> {
  const rows = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: {
      id: true,
      flightNumber: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
      departureTime: true,
      depTimeSemantics: true,
    },
  });

  const codes = new Set<string>();
  for (const row of rows) {
    const dep = row.depIata ?? row.depIcao;
    const arr = row.arrIata ?? row.arrIcao;
    if (dep) codes.add(dep);
    if (arr) codes.add(arr);
  }
  const airports = await getCachedAirports([...codes]);

  const events: CrossDomainEventRow[] = [];
  const countryRows: CrossDomainCountryRow[] = [];
  for (const row of rows) {
    const depCode = row.depIata ?? row.depIcao;
    const arrCode = row.arrIata ?? row.arrIcao;
    const depAirport = depCode ? airports.get(depCode) : undefined;
    const arrAirport = arrCode ? airports.get(arrCode) : undefined;

    let year: number | null = null;
    const dayKeys: string[] = [];
    if (row.departureTime) {
      const clock = localWallClockOf(
        row.departureTime,
        depAirport?.timezone ?? null,
        row.depTimeSemantics as FlightTimeSemantics
      );
      if (Number.isFinite(clock.year)) {
        year = clock.year;
        dayKeys.push(clock.date);
      }
    }

    const entry = withoutContribution(
      flightEvidenceEntry(
        {
          id: row.id,
          flightNumber: row.flightNumber,
          depIata: row.depIata,
          arrIata: row.arrIata,
          departureTime: row.departureTime,
        },
        1
      )
    );
    events.push({ domain: "flight", entry, year, dayKeys });

    // A Set per flight: a domestic leg proves ONE country, not two. An
    // arrival airport that is not on file proves nothing rather than a
    // second "Unknown".
    const touched = new Set<string>();
    const depCountry = toCountryCode(depAirport?.country);
    if (depCountry) touched.add(depCountry);
    if (arrCode) {
      const arrCountry = toCountryCode(arrAirport?.country);
      if (arrCountry) touched.add(arrCountry);
    }
    countryRows.push({
      domain: "flight",
      entry,
      countries: [...touched],
      years: year === null ? [] : [year],
    });
  }
  return { events, countryRows };
}

/**
 * `adaptCruise` + `calculateCruiseStats`. Countries come from the whole
 * itinerary — the stops' ports plus the departure and arrival ports — and
 * the year bucket is the START year, in UTC, exactly as `countriesByYear`
 * there is built.
 */
async function loadCruises(userId: string): Promise<CrossDomainPopulation> {
  const rows = await prisma.cruise.findMany({
    where: { userId },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      routeName: true,
      shipNameOverride: true,
      ship: { select: { name: true } },
      departurePort: { select: { country: true } },
      arrivalPort: { select: { country: true } },
      stops: { select: { isAtSea: true, port: { select: { country: true } } } },
    },
  });

  const events: CrossDomainEventRow[] = [];
  const countryRows: CrossDomainCountryRow[] = [];
  for (const row of rows) {
    if (!isCountableCruiseStatus(row.status)) continue;
    const entry = cruiseEvidenceEntry(
      {
        id: row.id,
        label: row.routeName ?? row.shipNameOverride ?? row.ship?.name ?? "—",
        startDate: row.startDate,
      },
      { subtitle: null }
    );

    let year: number | null = null;
    let dayKeys: string[] = [];
    if (row.startDate && !Number.isNaN(row.startDate.getTime())) {
      year = row.startDate.getUTCFullYear();
      // No end date is a one-day event: still worth charting, and inventing
      // a length would be worse than reporting the day it happened.
      const end = row.endDate && !Number.isNaN(row.endDate.getTime()) ? row.endDate : row.startDate;
      dayKeys = inclusiveUtcDays(row.startDate, end);
    }
    events.push({ domain: "cruise", entry, year, dayKeys });

    const touched = new Set<string>();
    for (const country of [
      row.departurePort?.country,
      row.arrivalPort?.country,
      ...row.stops.filter((s) => !s.isAtSea).map((s) => s.port?.country),
    ]) {
      const code = toCountryCode(country);
      if (code) touched.add(code);
    }
    countryRows.push({
      domain: "cruise",
      entry,
      countries: [...touched],
      years: year === null ? [] : [year],
    });
  }
  return { events, countryRows };
}

/**
 * `adaptLodging` + `calculateLodgingStats`. The event is the STAY and the
 * country is the LODGING's, because a house the user entered without
 * recording a stay still proves its country (owner, 2026-09-02).
 */
async function loadLodging(userId: string): Promise<CrossDomainPopulation> {
  const lodgings = await prisma.lodging.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      country: true,
      isoCountryCode: true,
      visited: true,
      stays: {
        select: { id: true, status: true, checkIn: true, checkOut: true },
      },
    },
  });

  const events: CrossDomainEventRow[] = [];
  const countryRows: CrossDomainCountryRow[] = [];
  for (const lodging of lodgings) {
    const states = lodging.stays.map((stay) => classifyStay(stay));
    const years = new Set<number>();
    for (const [index, stay] of lodging.stays.entries()) {
      if (states[index] !== "visited") continue;
      let year: number | null = null;
      let dayKeys: string[] = [];
      // The adapter expands stays into DAY buckets and so needs real dates;
      // an undated stay counts in the lifetime total and marks no day.
      if (stay.checkIn && !Number.isNaN(stay.checkIn.getTime())) {
        year = stay.checkIn.getUTCFullYear();
        years.add(year);
        const checkOut =
          stay.checkOut && !Number.isNaN(stay.checkOut.getTime()) ? stay.checkOut : stay.checkIn;
        dayKeys = stayDays(stay.checkIn, checkOut);
      }
      events.push({
        domain: "lodging",
        entry: stayEvidenceEntry(
          {
            id: stay.id,
            lodgingId: lodging.id,
            lodgingName: lodging.name,
            checkIn: stay.checkIn,
          },
          { subtitle: null }
        ),
        year,
        dayKeys,
      });
    }

    if (classifyLodging(lodging, states) !== "visited") continue;
    const code = lodgingCountryKey(lodging);
    if (!code) continue;
    countryRows.push({
      domain: "lodging",
      entry: stayEvidenceEntry(
        // The country's evidence is the HOUSE, so both ids are the lodging's.
        { id: lodging.id, lodgingId: lodging.id, lodgingName: lodging.name, checkIn: null },
        { subtitle: null }
      ),
      countries: [code],
      years: [...years],
    });
  }
  return { events, countryRows };
}

/**
 * `adaptPoi`. The event is the VISIT — three trips to one café are three
 * points on the activity chart — while the country is the PLACE's, which a
 * place marked visited proves with no visit row at all.
 */
async function loadPlaces(userId: string): Promise<CrossDomainPopulation> {
  const places = await prisma.place.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      isoCountryCode: true,
      visited: true,
      visits: { select: { id: true, visitedAt: true } },
    },
  });

  const now = new Date();
  const events: CrossDomainEventRow[] = [];
  const countryRows: CrossDomainCountryRow[] = [];
  for (const place of places) {
    const plannedVisitCount = place.visits.filter(
      (visit) => classifyVisit(visit, now) === "planned"
    ).length;
    if (classifyPlace({ visited: place.visited, plannedVisitCount }) !== "visited") continue;

    const years = new Set<number>();
    for (const visit of place.visits) {
      if (classifyVisit(visit, now) !== "visited") continue;
      let year: number | null = null;
      let dayKeys: string[] = [];
      if (visit.visitedAt && !Number.isNaN(visit.visitedAt.getTime())) {
        year = visit.visitedAt.getUTCFullYear();
        years.add(year);
        dayKeys = [utcDayKey(visit.visitedAt)];
      }
      events.push({
        domain: "poi",
        entry: placeEvidenceEntry(
          { id: visit.id, placeId: place.id, placeName: place.name, visitedAt: visit.visitedAt },
          { subtitle: null }
        ),
        year,
        dayKeys,
      });
    }

    // The raw ISO column, upper-cased — the adapter's own normalisation, not
    // `toCountryCode`, which would silently place a value this column is not
    // allowed to hold.
    const code = place.isoCountryCode?.toUpperCase();
    if (!code) continue;
    countryRows.push({
      domain: "poi",
      entry: placeEvidenceEntry(
        { id: place.id, placeId: place.id, placeName: place.name, visitedAt: null },
        { subtitle: null }
      ),
      countries: [code],
      years: [...years],
    });
  }
  return { events, countryRows };
}

/**
 * Roadtrips (2.7). The event is the roadtrip, spanning its stations' dates
 * (a linked stay's dates where the station has none); the countries are the
 * ones its stations stand in, read from their coordinates.
 *
 * A roadtrip that has not started yet is PLANNED and counts nowhere — the
 * same line the lodging rule draws for a stay whose dates are still ahead.
 * An undated roadtrip counts, with no year: it happened, the logbook just
 * does not say when.
 */
async function loadRoadtrips(userId: string): Promise<CrossDomainPopulation> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: {
      id: true,
      name: true,
      stops: {
        select: {
          lat: true,
          lon: true,
          startDate: true,
          endDate: true,
          lodgingStay: {
            select: {
              checkIn: true,
              checkOut: true,
              lodging: { select: { isoCountryCode: true } },
            },
          },
        },
      },
    },
  });
  if (rows.length === 0) return { events: [], countryRows: [] };

  const resolver = await getCountryResolver();
  const now = Date.now();
  const events: CrossDomainEventRow[] = [];
  const countryRows: CrossDomainCountryRow[] = [];
  for (const row of rows) {
    let start: Date | null = null;
    let end: Date | null = null;
    for (const stop of row.stops) {
      const from = stop.startDate ?? stop.lodgingStay?.checkIn ?? null;
      const to = stop.endDate ?? stop.lodgingStay?.checkOut ?? from;
      if (from && (!start || from < start)) start = from;
      if (to && (!end || to > end)) end = to;
    }
    if (start && start.getTime() > now) continue;

    const entry = roadtripEvidenceEntry(
      { id: row.id, name: row.name, startDate: start },
      { subtitle: null }
    );
    const year = start ? start.getUTCFullYear() : null;
    const dayKeys = start ? inclusiveUtcDays(start, end ?? start) : [];
    events.push({ domain: "roadtrip", entry, year, dayKeys });

    countryRows.push({
      domain: "roadtrip",
      entry,
      countries: stationCountries(row.stops, resolver),
      years: year === null ? [] : [year],
    });
  }
  return { events, countryRows };
}

/**
 * Mirrors `railStatsAdapter.ts`: a completed ride is one event, filed under
 * the year it left on its departure station's calendar, active on the day it
 * left and — for a night train — the day it arrived, each on its own
 * station's clock; it proves both stations' countries. Every one of those
 * rules lives in `shared/railCounting.ts`, which both sides mirror.
 */
async function loadRail(userId: string): Promise<CrossDomainPopulation> {
  const rows = await prisma.railJourney.findMany({
    where: { userId, ...countableRailWhere() },
    select: {
      id: true,
      depStationName: true,
      arrStationName: true,
      depCountry: true,
      arrCountry: true,
      depTimezone: true,
      arrTimezone: true,
      departureTime: true,
      arrivalTime: true,
    },
  });
  const events: CrossDomainEventRow[] = [];
  const countryRows: CrossDomainCountryRow[] = [];
  for (const row of rows) {
    const entry = railEvidenceEntry(
      {
        id: row.id,
        label: `${row.depStationName} → ${row.arrStationName}`,
        departureTime: row.departureTime,
      },
      { subtitle: null }
    );
    const year = railYear(row);
    events.push({ domain: "rail", entry, year, dayKeys: railDayKeys(row) });
    countryRows.push({ domain: "rail", entry, countries: railCountries(row), years: [year] });
  }
  return { events, countryRows };
}

const LOADERS: Record<DomainKey, (userId: string) => Promise<CrossDomainPopulation>> = {
  flight: loadFlights,
  cruise: loadCruises,
  lodging: loadLodging,
  poi: loadPlaces,
  roadtrip: loadRoadtrips,
  rail: loadRail,
};

/** Loads only the domains asked for — a chip that is off is never queried. */
export async function loadCrossDomainPopulation(
  userId: string,
  domains: readonly DomainKey[]
): Promise<CrossDomainPopulation> {
  const loaded = await Promise.all(domains.map((domain) => LOADERS[domain](userId)));
  return {
    events: loaded.flatMap((part) => part.events),
    countryRows: loaded.flatMap((part) => part.countryRows),
  };
}
