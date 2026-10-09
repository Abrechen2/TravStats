import { prisma } from "../../db";
import { countableFlightWhere } from "../../shared/flightCounting";
import { countableRailWhere, railYear } from "../../shared/railCounting";
import { classifyStay } from "../../shared/lodgingCounting";
import { resolveStayTiming } from "../../shared/lodgingTiming";
import { classifyVisit, visitYear } from "../../shared/placeCounting";
import { countableRentalWhere, rentalDays, rentalYear } from "../../shared/rentalCounting";
import { busYear, countableBusWhere } from "../../shared/busCounting";
import { nightBusNights } from "../../shared/busRideKinds";
import { localDay } from "../../shared/time/instant";
import { now as clockNow } from "../../shared/time/clock";
import type { DomainKey } from "../../shared/domains";
import { loadVisibleDomainSet, type VisibleDomains } from "../domainVisibility";
import { toursVisible } from "../tourVisibility";
import { roadtripHasStarted } from "./roadtripEvidence";
import type { WrappedCruise, WrappedRail } from "./wrapped";
import type { WrappedChapterRows } from "./wrappedChapters";
import { loadPassport, type PassportLoaderFlight } from "./passportLoader";

/**
 * The non-flight rows the year in review reads — loaded here so the stats
 * router, frozen at its size by the file-size ratchet, names one call instead
 * of a query per domain.
 *
 * Every domain passes the user's own gate (`domainVisibility`) first: a domain
 * switched off, or behind the beta switch, contributes no chapter and no year
 * to the picker (forgejo#265). Flights too: `flightsVisible` tells
 * `buildWrapped` to leave them out of the story and the picker.
 *
 * Each row is counted and filed by its domain's own rule:
 *  - rail: completed rides, the year they LEFT on the departure station's
 *    calendar (`railCounting`);
 *  - stays: those that are over (`lodgingCounting.classifyStay`), under the
 *    check-in's year where the record can be placed in one (`lodgingTiming`);
 *  - places: visits that happened, on the place's calendar (`placeCounting`);
 *  - roadtrips: those that have started, under their first station's year;
 *  - tours: dated day tours whose day is past (`tourDate`, a floating date),
 *    while the instance shows tours (`toursVisible`, the web's rule — not the
 *    roadtrip domain toggle);
 *  - rentals: completed, under the pickup's year (`rentalCounting`);
 *  - bus: completed rides, the year they left (`busCounting`), with the nights
 *    a night bus ran through (`busRideKinds`).
 */
export async function loadWrappedDomains(userId: string): Promise<{
  cruises: WrappedCruise[];
  rail: WrappedRail[];
  chapters: WrappedChapterRows;
}> {
  const visible = await loadVisibleDomainSet(userId);
  const now = clockNow();
  const [cruises, rides, chapters] = await Promise.all([
    whenVisible(visible, "cruise", () =>
      prisma.cruise.findMany({
        where: { userId, ...countableFlightWhere() },
        select: { startDate: true, status: true },
      })
    ),
    whenVisible(visible, "rail", () =>
      prisma.railJourney.findMany({
        where: { userId, ...countableRailWhere() },
        select: {
          departureTime: true,
          arrivalTime: true,
          depTimezone: true,
          arrTimezone: true,
          distanceKm: true,
          distanceSource: true,
        },
      })
    ),
    loadChapterRows(userId, visible, now),
  ]);
  return {
    cruises: cruises ?? [],
    rail: (rides ?? []).map((r) => ({
      year: railYear(r),
      distanceKm: r.distanceKm,
      distanceSource: r.distanceSource,
    })),
    chapters,
  };
}

/** The rows of a domain the user sees, else null — "no chapter", not "a chapter of zeros". */
function whenVisible<T>(
  visible: VisibleDomains,
  domain: DomainKey,
  load: () => Promise<T[]>
): Promise<T[] | null> {
  return visible.has(domain) ? load() : Promise.resolve(null);
}

async function loadChapterRows(
  userId: string,
  visible: VisibleDomains,
  now: Date
): Promise<WrappedChapterRows> {
  const [stays, visits, roadtripRoutes, tourRoutes, rentals, bus] = await Promise.all([
    whenVisible(visible, "lodging", () =>
      prisma.lodgingStay.findMany({
        where: { userId },
        select: { status: true, checkIn: true, checkOut: true, datePrecision: true, nights: true },
      })
    ),
    whenVisible(visible, "poi", () =>
      prisma.placeVisit.findMany({
        where: { place: { userId } },
        select: { placeId: true, visitedAt: true, visitedAtUtc: true, visitedZone: true },
      })
    ),
    // Roadtrips follow the user's domain gate; day tours are not a domain and
    // follow `toursVisible` alone — the web's `useToursVisible` (one rule).
    whenVisible(visible, "roadtrip", () =>
      prisma.tripRoute.findMany({
        where: { userId, kind: "roadtrip" },
        select: {
          stops: {
            where: { viaPoint: false },
            select: { startDate: true, lodgingStay: { select: { checkIn: true } } },
          },
        },
      })
    ),
    toursVisible().then((shown) =>
      shown
        ? prisma.tripRoute.findMany({
            where: { userId, kind: "tour" },
            select: { tourDate: true },
          })
        : null
    ),
    whenVisible(visible, "rental", () =>
      prisma.rentalBooking.findMany({
        where: { userId, ...countableRentalWhere() },
        select: { pickupTime: true, pickupTimezone: true, returnTime: true, returnTimezone: true },
      })
    ),
    whenVisible(visible, "bus", () =>
      prisma.busJourney.findMany({
        where: { userId, ...countableBusWhere() },
        select: {
          departureTime: true,
          arrivalTime: true,
          depTimezone: true,
          arrTimezone: true,
          depPrecision: true,
          arrPrecision: true,
          distanceKm: true,
        },
      })
    ),
  ]);

  const today = localDay(now, "UTC");
  return {
    flightsVisible: visible.has("flight"),
    lodging:
      stays === null
        ? null
        : stays.flatMap((s) => {
            if (classifyStay(s, now) !== "visited") return [];
            const timing = resolveStayTiming(s);
            if (!timing.canBucketByYear || timing.anchor === null) return [];
            return [
              {
                year: timing.anchor.getUTCFullYear(),
                nights: timing.nightsKnown ? timing.nights : null,
              },
            ];
          }),
    places:
      visits === null
        ? null
        : visits.flatMap((v) => {
            const year = classifyVisit(v, now) === "visited" ? visitYear(v) : null;
            return year === null ? [] : [{ year, placeId: v.placeId }];
          }),
    roadtrips:
      roadtripRoutes === null
        ? null
        : roadtripRoutes.flatMap((route) => {
            if (!roadtripHasStarted(route.stops, now)) return [];
            const starts = route.stops
              .map((s) => s.startDate ?? s.lodgingStay?.checkIn ?? null)
              .filter((d): d is Date => d !== null)
              .sort((a, b) => a.getTime() - b.getTime());
            // A roadtrip with no dated station has started in no particular year.
            return starts.length === 0 ? [] : [{ year: starts[0].getUTCFullYear() }];
          }),
    tours:
      tourRoutes === null
        ? null
        : tourRoutes.flatMap((route) => {
            if (route.tourDate === null) return [];
            // A floating date: its stored components ARE the day (ADR 0002 D1).
            const day = route.tourDate.toISOString().slice(0, 10);
            return day > today ? [] : [{ year: Number(day.slice(0, 4)) }];
          }),
    rentals:
      rentals === null ? null : rentals.map((r) => ({ year: rentalYear(r), days: rentalDays(r) })),
    bus:
      bus === null
        ? null
        : bus.map((r) => ({
            year: busYear(r),
            distanceKm: r.distanceKm,
            nights: nightBusNights(r).length,
          })),
  };
}

/**
 * The passport the year in review takes `newCountries` from, cut to what the
 * user sees (forgejo#265 review M1): flights, rail, bus, roadtrips and places
 * of a hidden domain prove no country here, as they add no chapter and no
 * year. Cruises and stays have no source switch in the passport loader yet and
 * still count, as before.
 */
export async function loadWrappedPassport(
  userId: string,
  flights: PassportLoaderFlight[]
): Promise<Awaited<ReturnType<typeof loadPassport>>> {
  const visible = await loadVisibleDomainSet(userId);
  return loadPassport(userId, visible.has("flight") ? flights : [], {
    rail: visible.has("rail"),
    bus: visible.has("bus"),
    roadtrip: visible.has("roadtrip"),
    place: visible.has("poi"),
  });
}
