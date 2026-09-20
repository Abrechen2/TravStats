// Aggregators that turn the raw `flights` / `cruises` arrays into the
// metadata fields shown on the pinned popup. Pure, no React, no
// network. Each returns a minimal shape with optional fields so the
// card UI can gracefully omit anything we couldn't derive.
//
// Phase B of the Globe pinned-card UX rework — Phase A wired up the
// MapLibre Popup anchor, this file backs the denser content.

import type { GeoJSONFeature } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import { isCountableCruise } from "../../../shared/cruiseCounting";
import { isCountableFlight } from "../../../shared/flightCounting";
import { resolveStayTiming } from "../../../shared/lodgingTiming";
import { classifyStay } from "../../../shared/lodgingCounting";
import { formatAmount } from "../../../lib/units";
import { formatDate as formatUserDate } from "../../../lib/displayFormat";
import type { LodgingCardStay } from "./pinnedTypes";

export interface AirportCardStats {
  totalVisits: number;
  /**
   * Kilometres actually covered through this airport. Only flown/historical
   * legs count — a scheduled flight has not covered any distance yet. Carried
   * over from the flat map's `AirportTooltip`, which the shared card replaced
   * on 2026-09-20; dropping it would have lost the one number that card had
   * and the globe's did not.
   */
  totalKm: number;
  lastVisitDate: string | null;
  longestRoute: { iata: string; km: number } | null;
  topAirline: string | null;
  topAircraft: string | null;
}

export interface PortCardStats {
  country: string | null;
  region: string | null;
  totalVisits: number;
  lastCallDate: string | null;
  ships: string[];
  longestPortCallMinutes: number | null;
}

export interface ArcCardStats {
  totalKm: number;
  /** Earliest departure in the selection — the trip card names a SPAN, and
   *  `TripTooltip` did before it; only "last flight" survived the move. */
  firstFlightDate: string | null;
  lastFlightDate: string | null;
  /** Sum of the selection's CO₂, or null when no leg records any. Never 0 for
   *  "unknown": `MapTooltip` printed the figure and a zero would read as a
   *  flight that emitted nothing. */
  totalCo2Kg: number | null;
  /** Most-frequently-flown aircraft type on this route. */
  topAircraft: string | null;
  topAirline: string | null;
}

export interface CruiseCardStats {
  shipName: string | null;
  line: string | null;
  /** The map draws a planned cruise differently; the card has to say which. */
  status: string | null;
  /** Already formatted with its currency, or null when none is recorded. */
  price: string | null;
  startDate: string | null;
  endDate: string | null;
  portCount: number;
  seaDays: number;
  embarkPort: string | null;
  debarkPort: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────

function modeOf(values: ReadonlyArray<string | undefined | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let topKey: string | null = null;
  let topCount = 0;
  for (const [k, c] of counts.entries()) {
    if (c > topCount) {
      topKey = k;
      topCount = c;
    }
  }
  return topKey;
}

function minDate(dates: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (best === null || d < best) best = d;
  }
  return best;
}

function maxDate(dates: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (best === null || d > best) best = d;
  }
  return best;
}

// ─── Airport ──────────────────────────────────────────────────────

export function getAirportStats(
  flights: readonly GeoJSONFeature[],
  iata: string
): AirportCardStats {
  const touched = flights.filter(
    (f) => f.properties.departureAirport.iata === iata || f.properties.arrivalAirport.iata === iata
  );
  const departures = touched.filter((f) => f.properties.departureAirport.iata === iata);

  // A scheduled flight must never count as a visit or bump the last-visit
  // date — it's a future plan, not something that happened. Cancelled
  // flights deliberately still count here (status !== "scheduled" keeps
  // them in) — a deferred semantic, not the bug this filter guards against.
  // That's an asymmetry vs. getPortStats below, which filters cruises down
  // to flown|historical explicitly (so cancelled cruises DON'T count as a
  // port call) — both are intentional, just answering different questions.
  const visitedOnly = touched.filter((f) => f.properties.status !== "scheduled");

  // Longest route originating from this airport, by distance.
  let longestRoute: AirportCardStats["longestRoute"] = null;
  for (const f of departures) {
    const arrIata = f.properties.arrivalAirport.iata;
    if (!arrIata) continue;
    const km = f.properties.distance ?? 0;
    if (longestRoute === null || km > longestRoute.km) {
      longestRoute = { iata: arrIata, km };
    }
  }

  let totalKm = 0;
  for (const f of touched) {
    if (isCountableFlight(f.properties)) totalKm += f.properties.distance ?? 0;
  }

  return {
    totalVisits: visitedOnly.length,
    totalKm,
    lastVisitDate: maxDate(visitedOnly.map((f) => f.properties.departureTime)),
    longestRoute,
    topAirline: modeOf(touched.map((f) => f.properties.airline)),
    topAircraft: modeOf(touched.map((f) => f.properties.aircraft)),
  };
}

// ─── Port ─────────────────────────────────────────────────────────

export function getPortStats(cruises: Cruise[], portKey: string): PortCardStats {
  // `portKey` is whatever the PointDatum carries — historically the
  // marker's iata-or-name slot. Match against unlocode AND name so
  // both code-keyed and name-keyed markers resolve.
  // Only sailed cruises (flown/historical) contribute an actual port call —
  // a scheduled cruise is a future plan, not a visit yet.
  const stops = cruises
    .filter(isCountableCruise)
    .flatMap((c) =>
      c.stops
        .filter(
          (s) =>
            s.port?.unlocode === portKey || s.port?.name === portKey || s.port?.city === portKey
        )
        .map((s) => ({ stop: s, cruise: c }))
    );

  const country = stops[0]?.stop.port?.country ?? null;
  const region = stops[0]?.stop.port?.region ?? null;

  const ships = Array.from(
    new Set(
      stops
        .map(({ cruise }) => cruise.ship?.name ?? cruise.shipNameOverride ?? null)
        .filter((s): s is string => s !== null)
    )
  );

  // Longest port-call: max(departureTime − arrivalTime) for stops with
  // both timestamps populated.
  let longestPortCallMinutes: number | null = null;
  for (const { stop } of stops) {
    if (!stop.arrivalTime || !stop.departureTime) continue;
    const minutes =
      (new Date(stop.departureTime).getTime() - new Date(stop.arrivalTime).getTime()) / 60000;
    if (minutes <= 0 || !Number.isFinite(minutes)) continue;
    if (longestPortCallMinutes === null || minutes > longestPortCallMinutes) {
      longestPortCallMinutes = minutes;
    }
  }

  return {
    country,
    region,
    totalVisits: stops.length,
    lastCallDate: maxDate(stops.map(({ stop }) => stop.arrivalTime)),
    ships,
    longestPortCallMinutes,
  };
}

// ─── Arc (flight route) ───────────────────────────────────────────

export function getArcStats(
  flights: readonly GeoJSONFeature[],
  flightIds: ReadonlyArray<string>
): ArcCardStats {
  const ids = new Set(flightIds);
  const matched = flights.filter((f) => ids.has(f.properties.id));

  const totalKm = matched.reduce((sum, f) => sum + (f.properties.distance ?? 0), 0);

  let totalCo2Kg: number | null = null;
  for (const f of matched) {
    const c = f.properties.co2Kg;
    if (typeof c === "number") totalCo2Kg = (totalCo2Kg ?? 0) + c;
  }

  const departures = matched.map((f) => f.properties.departureTime);
  return {
    totalKm,
    firstFlightDate: minDate(departures),
    lastFlightDate: maxDate(departures),
    totalCo2Kg,
    topAircraft: modeOf(matched.map((f) => f.properties.aircraft)),
    topAirline: modeOf(matched.map((f) => f.properties.airline)),
  };
}

// ─── Cruise ───────────────────────────────────────────────────────

export function getCruiseStats(
  cruises: readonly Cruise[],
  cruiseId: string,
  locale = "de"
): CruiseCardStats | null {
  const cruise = cruises.find((c) => c.id === cruiseId);
  if (!cruise) return null;

  const portStops = cruise.stops.filter((s) => !s.isAtSea);
  const seaDays = cruise.stops.filter((s) => s.isAtSea).length;

  return {
    shipName: cruise.ship?.name ?? cruise.shipNameOverride ?? null,
    line: cruise.cruiseLine ?? cruise.ship?.cruiseLine ?? null,
    status: cruise.status ?? null,
    price:
      cruise.price != null
        ? formatAmount(cruise.price, cruise.currency as never, { language: locale })
        : null,
    startDate: cruise.startDate,
    endDate: cruise.endDate,
    portCount: portStops.length,
    seaDays,
    embarkPort: cruise.departurePort?.name ?? null,
    debarkPort: cruise.arrivalPort?.name ?? null,
  };
}

// ─── Lodging: which stay ──────────────────────────────────────────

export interface LatestStayFacts {
  /** "01.05.2024 – 04.05.2024", or null when no real day is recorded. */
  dateRange: string | null;
  /** Formatted with its own currency. Null whenever `dateRange` is, because a
   *  price with nothing naming the stay it belongs to cannot be placed. */
  price: string | null;
  /** True when the named stay has NOT happened yet — the card says so. */
  upcoming: boolean;
}

/**
 * Which stay the card is about.
 *
 * The most recent one already slept, and only if there is none, the NEAREST
 * booking ahead — flagged as upcoming, never presented as a visit.
 *
 * It used to be "the maximum ISO date", which meant a booking for next month
 * beat every night already spent here. The hero counts only stays whose
 * check-out is past (`shared/lodgingCounting.ts`, owner rule 2026-08-15), so
 * the card read "2 Aufenthalte" above a stay that count deliberately excludes.
 * Whether a stay has happened is that module's question, asked rather than
 * re-decided here.
 *
 * The SPAN is a different module's question again: a stay can be dated to the
 * day, the month, the year or not at all, and only `shared/lodgingTiming.ts`
 * knows which of those is safe to print as a date. At anything but DAY
 * precision the stored dates are placeholders, so there is no range — and with
 * no range the price is withheld too, because a number under a lifetime nights
 * figure with nothing naming its visit is a number the reader cannot place.
 */
export function latestStayFacts(
  stays: ReadonlyArray<LodgingCardStay> | undefined,
  locale: string,
  now?: Date
): LatestStayFacts {
  const none: LatestStayFacts = { dateRange: null, price: null, upcoming: false };
  if (!stays || stays.length === 0) return none;

  const asDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);
  const key = (s: LodgingCardStay): string => s.checkIn ?? s.checkOut ?? "";
  const classified = stays.map((s) => ({
    stay: s,
    state: classifyStay(
      {
        status: s.status ?? "confirmed",
        checkIn: asDate(s.checkIn),
        checkOut: asDate(s.checkOut),
        datePrecision: s.datePrecision,
        nights: s.nights,
      },
      now
    ),
  }));

  const past = classified.filter((c) => c.state === "visited");
  const ahead = classified.filter((c) => c.state === "planned");

  let chosen: LodgingCardStay;
  let upcoming: boolean;
  if (past.length > 0) {
    chosen = past.reduce((best, c) => (key(c.stay) > key(best.stay) ? c : best)).stay;
    upcoming = false;
  } else if (ahead.length > 0) {
    // The NEAREST booking, not the furthest: "when am I next there" is the
    // question a future-only hotel answers.
    chosen = ahead.reduce((best, c) =>
      key(c.stay) !== "" && (key(best.stay) === "" || key(c.stay) < key(best.stay)) ? c : best
    ).stay;
    upcoming = true;
  } else {
    // Every stay cancelled, or undated and unclassifiable: name none.
    return none;
  }

  const timing = resolveStayTiming({
    checkIn: asDate(chosen.checkIn),
    checkOut: asDate(chosen.checkOut),
    datePrecision: chosen.datePrecision,
    nights: chosen.nights,
  });

  const day = (iso: string): string => formatUserDate(iso) || iso.slice(0, 10);
  const dateRange =
    timing.precision !== "DAY"
      ? null
      : chosen.checkIn && chosen.checkOut
        ? `${day(chosen.checkIn)} – ${day(chosen.checkOut)}`
        : (chosen.checkIn ?? chosen.checkOut) !== null
          ? day((chosen.checkIn ?? chosen.checkOut) as string)
          : null;

  const price =
    dateRange !== null && chosen.totalPrice != null
      ? formatAmount(chosen.totalPrice, chosen.currency as never, { language: locale })
      : null;

  return { dateRange, price, upcoming };
}
