import { Router, Response, NextFunction } from "express";
import { Prisma } from "../prisma";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemoQuota } from "../middleware/demoGuard";
import { normalizeQueryParams, resolveFlightWhere, splitMultiValue } from "./flights/queryFilters";
import { flightListHandler } from "./flights/list";
import { flightFacetsHandler } from "./flights/facets";
import { nextFlightHandler } from "./flights/next";
import { deleteFlightHandler } from "./flights/remove";
import { createFlightHandler } from "./flights/create";
import { propagateWrite, shareSnapshot } from "../services/sharing/propagate";
import { updateFlightSchema, flightQuerySchema } from "../schemas/flight";
import logger from "../utils/logger";
import { AppError } from "../middleware/errorHandler";
import {
  applyDepartureTimesAndDelay,
  applyExtendedFlightFields,
  type ExtendedFlightInput,
} from "../services/flights/extendedFlightFields";
import { calculateDistance, generateArcPoints } from "../utils/geo";
import { checkAndUpdateAchievements } from "../utils/achievements";
import { enrichFlightAirports } from "../services/airportLookup";
import { flightCreationLimiter, statsLimiter } from "../middleware/rateLimit";
import {
  findEnrichmentCandidates,
  getUserEnrichmentSettings,
  aggregateFlightData,
  createHistoricalEnrichment,
} from "../services/flightEnrichmentService";
import {
  countBulkRefreshCandidates,
  hasHistoricalProvider,
  runBulkRefresh,
} from "../services/bulkFlightRefresh";
import { getProviderQuota } from "../services/apiQuota";
import { estimateRoute } from "../services/routeEstimationService";
import { calculateCo2Kg, haversineKm, toSeatClass } from "../services/co2Calculator";
import { compareAirportAuthority } from "../services/airportCache";
import {
  enrichFlightsForClients,
  type AirportFacts,
  type ClientFlight,
} from "../services/flightAirportFacts";
import { withAirportTimezones } from "../services/flightTimezoneDefaults";
import { airportChanged, flightZoneColumns, withStoredZones } from "./flights/timeInput";
import {
  buildAirportCoordinateIndex,
  resolveAirportCoordinate,
} from "../services/airportCoordinates";
import { assertMergedChronology, toUtcDate } from "../services/flights/mergedChronology";
import { airlineCodeUpdate } from "../utils/airlineCodeUpdate";
import { normalizeAircraft } from "../utils/aircraftNormalize";
import { calculateNextApiCheckAt } from "../utils/smartCheckSchedule";
import batchRouter from "./flightsBatch";
import { deriveFlightStatus, FLIGHT_PASSTHROUGH } from "../shared/statusDerivation";
import { resolveCompanions, linkRowsFor } from "../services/companionService";
import { flightOwnAmount, getBaseCurrency } from "../services/fx/snapshot";
import { refreshFxOnEdit } from "../services/fx/refreshOnEdit";

const router = Router();

// Interface for flight update data
interface FlightUpdateData extends ExtendedFlightInput {
  // FX snapshot columns (#267) — written together by `fxColumnsFor`, never
  // individually, so a rate can never end up belonging to a different amount.
  priceBase?: number | null;
  fxRate?: number | null;
  fxRateDate?: Date | null;
  fxBaseCurrency?: string | null;
  fxSource?: string | null;
  airline?: string | null;
  airlineIata?: string | null;
  airlineIcao?: string | null;
  operatingAirline?: string | null;
  operatingAirlineIata?: string | null;
  operatingAirlineIcao?: string | null;
  isCodeshare?: boolean | null;
  flightNumber?: string | null;
  callsign?: string | null;
  aircraft?: string | null;
  aircraftRegistration?: string | null;
  aircraftModeS?: string | null;
  status?: string;
  notes?: string | null;
  price?: number | null;
  taxes?: number | null;
  fees?: number | null;
  currency?: string | null;
  category?: string | null;
  seatClass?: string | null;
  tags?: string[];
  companions?: string[];
  receiptUrl?: string | null;
  depIcao?: string | null;
  depIata?: string | null;
  depName?: string | null;
  depLat?: number;
  depLon?: number;
  arrIcao?: string | null;
  arrIata?: string | null;
  arrName?: string | null;
  arrLat?: number;
  arrLon?: number;
  departureTime?: Date;
  arrivalTime?: Date;
  actualDeparture?: Date | null;
  actualArrival?: Date | null;
  delayMinutes?: number | null;
  co2Kg?: number | null;
  routeDistance?: number | null;
  lastModifiedBy?: string;
  nextApiCheckAt?: Date | null;
  depTimeSemantics?: string;
  arrTimeSemantics?: string;
  // Special flights (Sonder-Flüge)
  specialType?: string | null;
  eventLat?: number | null;
  eventLon?: number | null;
  eventLabel?: string | null;
  patternLat?: number | null;
  patternLon?: number | null;
  specialData?: Prisma.InputJsonValue | typeof Prisma.JsonNull; // Prisma 7: NullTypes is a value, not a namespace of types
  // Boarding pass / email import fields — written on POST, must also be
  // updatable via PUT. Their absence here was a silent-drop bug.
  seatNumber?: string | null;
  boardingGroup?: string | null;
  gate?: string | null;
  terminal?: string | null;
  bookingReference?: string | null;
  ticketNumber?: string | null;
  baggageAllowance?: string | null;
  frequentFlyerNumber?: string | null;
  bookingClassLetter?: string | null;
  coPassengers?: string[];
  dataSource?: string;
}

// All routes require authentication.
// `requireWriteScope` is method-aware: GET/HEAD/OPTIONS pass through, anything
// else demands a write- or admin-scoped PAT (cookie sessions are unaffected).
// Order matters — must run before the batchRouter mount so /flights/batch
// inherits the same scope check.
router.use(authenticate);
router.use(requireWriteScope);
router.use(batchRouter);

// Create flight (rate limited to prevent abuse). The handler lives in
// ./flights/create.ts: this file is frozen at its size and may only shrink.
router.post("/", flightCreationLimiter, createFlightHandler);

router.get("/next", nextFlightHandler);

/**
 * Single-row shorthand for the ONE enrichment — see services/flightAirportFacts.ts.
 *
 * The write handlers below answer with a flight the client renders straight
 * away, which makes them read paths too. Skipping the enrichment there brings
 * back exactly the bug that file exists to prevent: the flight just saved
 * shows each end in UTC while the list shows it in the airport's clock.
 *
 * It also settles `durationMinutes`. A bare `res.json(flight)` would hand out
 * the RAW `duration_minutes` column, which is NULL for a LEGACY_FAKE_UTC pair
 * ON PURPOSE (forgejo#45) — a client reading that raw NULL would conclude "no
 * duration" for a flight the list endpoint answers a duration for.
 *
 * Why this DERIVES the duration instead of reading that stored column: the
 * enrichment resolves the airport catalogue anyway, for the timezones and
 * countries, and on a row that has been through the catalogue the column and
 * the derivation are the same function. The column holds the naive difference
 * for precisely the rows whose derivation IS the naive difference, and NULL
 * for the rest — DATE_ONLY and missing clocks (no duration either way) and the
 * LEGACY_FAKE_UTC pair, which has to be derived regardless.
 * `__tests__/flightDurationColumn.test.ts` pins that equality for all sixteen
 * semantics combinations. Reading the column here would save nothing and would
 * cost every caller of the enrichment an extra `select` — including
 * `/stats/records`, which passes a deliberately narrow projection. The column
 * keeps earning its place where the catalogue is NOT already loaded.
 */
async function withAirportFacts<T extends ClientFlight>(flight: T): Promise<T & AirportFacts> {
  const [enriched] = await enrichFlightsForClients([flight]);
  return enriched;
}

// Get flights with filters. The handler lives in ./flights/list.ts: this file
// is frozen at its size in scripts/file-size-baseline.json and may only shrink.
router.get("/", flightListHandler);
// Option lists + figures drawn AROUND that page; before "/:id", which would
// otherwise swallow the word "facets".
router.get("/facets", flightFacetsHandler);

// Get flights as GeoJSON
router.get("/geo", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const normalizedQuery = normalizeQueryParams(
      req.query as Record<string, string | string[] | undefined>
    );
    const parsedQuery = flightQuerySchema.parse(normalizedQuery);
    const tagsArray = splitMultiValue(parsedQuery.tags as string | string[] | undefined);
    const query = {
      ...parsedQuery,
      tags: tagsArray,
      limit: Math.min(parsedQuery.limit ?? 100, 500),
    };
    const { where, noResults } = await resolveFlightWhere(query, userId);

    if (noResults) {
      return res.json({
        type: "FeatureCollection",
        features: [],
      });
    }

    const flights = await prisma.flight.findMany({
      where,
      // Deterministic tie-breaker: departureTime is nullable and not unique, so
      // paginating getAllGeoJSON on it alone would skip/duplicate rows at the
      // 500-row page boundaries. The id keeps the total order stable, so every
      // flight is plotted exactly once across all pages.
      orderBy: [{ departureTime: "desc" }, { id: "asc" }],
      skip: query.offset,
      take: query.limit,
    });

    // Flights don't store a departure/arrival country — resolve the ISO
    // alpha-2 code per airport in one batch so the map overlays can render a
    // country flag. Keyed by IATA first, then ICAO, so code-less airfields
    // still resolve when they have an ICAO.
    const iatas = new Set<string>();
    const icaos = new Set<string>();
    for (const f of flights) {
      if (f.depIata) iatas.add(f.depIata);
      if (f.arrIata) iatas.add(f.arrIata);
      if (f.depIcao) icaos.add(f.depIcao);
      if (f.arrIcao) icaos.add(f.arrIcao);
    }
    interface AirportInfo {
      country: string | null;
      city: string | null;
    }
    const infoByIata = new Map<string, AirportInfo>();
    const infoByIcao = new Map<string, AirportInfo>();
    let coordinateIndex = buildAirportCoordinateIndex([]);
    if (iatas.size > 0 || icaos.size > 0) {
      const airports = await prisma.airport.findMany({
        where: {
          OR: [{ iata: { in: [...iatas] } }, { icao: { in: [...icaos] } }],
        },
        select: {
          iata: true,
          icao: true,
          country: true,
          city: true,
          lat: true,
          lon: true,
          isClosed: true,
        },
      });
      // Sort most-authoritative first so a closed predecessor sharing the code
      // (MUC-Riem, TXL, THF) never supplies the country, city or position for a
      // live flight, and take the first row per code.
      const authoritativeFirst = [...airports].sort(compareAirportAuthority);
      for (const a of authoritativeFirst) {
        const info: AirportInfo = { country: a.country ?? null, city: a.city ?? null };
        if (a.iata && !infoByIata.has(a.iata)) infoByIata.set(a.iata, info);
        if (a.icao && !infoByIcao.has(a.icao)) infoByIcao.set(a.icao, info);
      }
      coordinateIndex = buildAirportCoordinateIndex(airports);
    }
    const airportInfo = (iata: string | null, icao: string | null): AirportInfo =>
      (iata ? infoByIata.get(iata) : undefined) ??
      (icao ? infoByIcao.get(icao) : undefined) ?? { country: null, city: null };

    const features = flights.map((flight) => {
      // Draw from the catalogue, not from the flight's own copy of the
      // coordinates. Those copies disagree between flights for the same
      // airport, and the map derives its airport DOT from the first-seen flight
      // per airport but each ARC from the first-seen flight per route — two
      // different "first seen" on two different coordinates, so the arc visibly
      // misses the dot (found at ZRH, 739 m out). Falls back to the stored
      // value for airports the catalogue does not know.
      const depPosition = resolveAirportCoordinate(
        coordinateIndex,
        flight.depIata,
        flight.depIcao,
        flight.depLat,
        flight.depLon
      );
      const arrPosition = resolveAirportCoordinate(
        coordinateIndex,
        flight.arrIata,
        flight.arrIcao,
        flight.arrLat,
        flight.arrLon
      );
      const arcPoints = generateArcPoints(depPosition, arrPosition);

      return {
        type: "Feature",
        properties: {
          id: flight.id,
          tripId: flight.tripId,
          airline: flight.airline,
          operatingAirline: flight.operatingAirline,
          flightNumber: flight.flightNumber,
          callsign: flight.callsign,
          aircraft: flight.aircraft,
          departureAirport: {
            icao: flight.depIcao,
            iata: flight.depIata,
            name: flight.depName,
            country: airportInfo(flight.depIata, flight.depIcao).country,
            city: airportInfo(flight.depIata, flight.depIcao).city,
          },
          arrivalAirport: {
            icao: flight.arrIcao,
            iata: flight.arrIata,
            name: flight.arrName,
            country: airportInfo(flight.arrIata, flight.arrIcao).country,
            city: airportInfo(flight.arrIata, flight.arrIcao).city,
          },
          departureTime: flight.departureTime,
          arrivalTime: flight.arrivalTime,
          status: flight.status,
          category: flight.category,
          tags: flight.tags || [],
          price: flight.price,
          currency: flight.currency,
          taxes: flight.taxes,
          fees: flight.fees,
          distance: calculateDistance(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon),
        },
        geometry: {
          type: "LineString",
          coordinates: arcPoints,
        },
      };
    });

    res.json({
      type: "FeatureCollection",
      features,
    });
  } catch (error) {
    next(error);
  }
});

// Bulk historical refresh — patches AeroDataBox-only fields
// (`aircraftRegistration`, `aircraftModeS`, `isCodeshare`, airline ICAO/IATA)
// onto existing flights that pre-date the Phase-2 enrichment commit.
//
// Demo users (seeded by `seedDemoUser`) are rejected to keep the local
// dev demo from draining real RapidAPI quota. Hard-capped at
// `MAX_PER_CALL` flights per request — the frontend re-clicks until the
// returned `remaining` hits zero.
router.get(
  "/refresh-historical-bulk/preview",
  statsLimiter, // a read: flightCreationLimiter here spent 20 flights/h on Settings visits
  rejectDemoQuota,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isDemo: true },
      });
      if (user?.isDemo) {
        return res.status(403).json({
          error: "DEMO_ACCOUNT_FORBIDDEN",
          message:
            "Bulk refresh is disabled for the demo account to keep RapidAPI quota intact. Use a real account on a production deployment.",
        });
      }
      const [remaining, hasProvider] = await Promise.all([
        countBulkRefreshCandidates(userId),
        hasHistoricalProvider(userId),
      ]);
      const adbQuota = getProviderQuota("aerodatabox", userId);
      const quota = adbQuota.kind === "observed" ? adbQuota : null;
      res.json({
        remaining,
        hasHistoricalProvider: hasProvider,
        aerodataboxQuota: quota,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/refresh-historical-bulk",
  flightCreationLimiter,
  rejectDemoQuota,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isDemo: true },
      });
      if (user?.isDemo) {
        return res.status(403).json({
          error: "DEMO_ACCOUNT_FORBIDDEN",
          message:
            "Bulk refresh is disabled for the demo account to keep RapidAPI quota intact. Use a real account on a production deployment.",
        });
      }

      if (!(await hasHistoricalProvider(userId))) {
        return res.status(409).json({
          error: "NO_HISTORICAL_PROVIDER",
          message:
            "Bulk refresh needs an AeroDataBox or Aviationstack key to look up flights older than today. Configure one in the API keys section above.",
        });
      }

      const summary = await runBulkRefresh(userId);
      const adbQuota = getProviderQuota("aerodatabox", userId);
      const quota = adbQuota.kind === "observed" ? adbQuota : null;
      res.json({ ...summary, aerodataboxQuota: quota });
    } catch (error) {
      next(error);
    }
  }
);

// Get enrichment candidates
router.get(
  "/enrichment-candidates",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const rawLimit = req.query.limit;
      const limit =
        rawLimit !== undefined
          ? Math.min(500, Math.max(1, parseInt(String(rawLimit), 10) || 10))
          : undefined;

      // Get user settings
      const settings = await getUserEnrichmentSettings(userId);
      if (!settings || !settings.enabled) {
        return res.json({
          candidates: [],
          settings: null,
          message: "Historical enrichment is disabled. Enable it in settings.",
        });
      }

      // Find candidates
      let candidates = await findEnrichmentCandidates(userId, settings);

      // Apply limit if provided
      if (limit !== undefined) {
        candidates = candidates.slice(0, limit);
      }

      res.json({
        candidates,
        settings,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get a single flight by id — added for API consumers (AI agents,
// scripts) that PATCH/PUT and want to read back the freshly-updated
// state without re-listing every flight. Returns the flight directly
// (not wrapped) so curl-piped jq filters stay simple.
router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const flight = await prisma.flight.findFirst({
      where: { id, userId },
      include: { trip: { select: { id: true, name: true, color: true } } },
    });
    if (!flight) {
      throw new AppError("Flight not found", 404);
    }
    // The detail page renders each end in ITS airport's clock from these
    // fields. Without them it falls back to UTC and contradicts the list.
    res.json(await withAirportFacts(flight));
  } catch (error) {
    next(error);
  }
});

// Update flight
router.put("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    // Check if flight exists and belongs to user
    const existingFlight = await prisma.flight.findFirst({
      where: { id, userId },
    });

    if (!existingFlight) {
      throw new AppError("Flight not found", 404);
    }
    // A wall clock at an unchanged airport is read in the zone the flight was
    // WRITTEN with, not today's catalogue zone (ADR 0002, class 4).
    const body = withStoredZones(req.body, existingFlight);
    const data = updateFlightSchema.parse(await withAirportTimezones(body));

    // The schema can only see the BODY. A PUT that moves only the departure
    // has to be checked against the arrival that stays behind — sending a
    // departure a day later used to answer 200 and leave the arrival in the
    // past (AUD-018). So the merged end state is checked here, on the real
    // instants, which is what the row actually stores.
    assertMergedChronology(data, existingFlight);

    // Enrich airport data if departure or arrival is being updated.
    // Use immutable references — never mutate the Zod-parsed `data` object.
    let enrichedDeparture = data.departure ?? null;
    let enrichedArrival = data.arrival ?? null;

    if (data.departure || data.arrival) {
      const enriched = await enrichFlightAirports({
        departure: data.departure
          ? {
              iata: data.departure.iata ?? undefined,
              icao: data.departure.icao ?? undefined,
              name: data.departure.name ?? undefined,
              lat: data.departure.lat,
              lon: data.departure.lon,
            }
          : {
              iata: existingFlight.depIata ?? undefined,
              icao: existingFlight.depIcao ?? undefined,
              name: existingFlight.depName ?? undefined,
              lat: existingFlight.depLat,
              lon: existingFlight.depLon,
            },
        arrival: data.arrival
          ? {
              iata: data.arrival.iata ?? undefined,
              icao: data.arrival.icao ?? undefined,
              name: data.arrival.name ?? undefined,
              lat: data.arrival.lat,
              lon: data.arrival.lon,
            }
          : {
              iata: existingFlight.arrIata ?? undefined,
              icao: existingFlight.arrIcao ?? undefined,
              name: existingFlight.arrName ?? undefined,
              lat: existingFlight.arrLat,
              lon: existingFlight.arrLon,
            },
      });

      if (data.departure) {
        enrichedDeparture = { ...data.departure, ...enriched.departure };
      }
      if (data.arrival) {
        enrichedArrival = { ...data.arrival, ...enriched.arrival };
      }
    }

    const updateData: FlightUpdateData = {};
    // `!== undefined`, not truthy: an explicit null CLEARS the airline. The
    // codes follow the name — see airlineCodeUpdate for why a renamed
    // operating airline no longer keeps the previous carrier's logo.
    if (data.airline !== undefined) updateData.airline = data.airline;
    const marketing = airlineCodeUpdate(
      data.airline,
      data.airlineIata,
      data.airlineIcao,
      existingFlight.airline
    );
    if (marketing.iata !== undefined) updateData.airlineIata = marketing.iata;
    if (marketing.icao !== undefined) updateData.airlineIcao = marketing.icao;
    if (data.operatingAirline !== undefined) updateData.operatingAirline = data.operatingAirline;
    const operating = airlineCodeUpdate(
      data.operatingAirline,
      data.operatingAirlineIata,
      data.operatingAirlineIcao,
      existingFlight.operatingAirline
    );
    if (operating.iata !== undefined) updateData.operatingAirlineIata = operating.iata;
    if (operating.icao !== undefined) updateData.operatingAirlineIcao = operating.icao;
    if (data.isCodeshare !== undefined) updateData.isCodeshare = data.isCodeshare;
    if (data.flightNumber !== undefined) updateData.flightNumber = data.flightNumber;
    if (data.callsign !== undefined) updateData.callsign = data.callsign;
    if (data.aircraft !== undefined)
      updateData.aircraft = data.aircraft ? normalizeAircraft(data.aircraft) : data.aircraft;
    if (data.aircraftRegistration !== undefined)
      updateData.aircraftRegistration = data.aircraftRegistration;
    if (data.aircraftModeS !== undefined) updateData.aircraftModeS = data.aircraftModeS;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.price !== undefined) updateData.price = data.price;
    if (data.taxes !== undefined) updateData.taxes = data.taxes;
    if (data.fees !== undefined) updateData.fees = data.fees;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.seatClass !== undefined) updateData.seatClass = data.seatClass;
    if (data.tags !== undefined) updateData.tags = data.tags;
    // Replace rather than append — an update always carries the FULL
    // companion list for the flight, so stale links must go. Resolution
    // itself (find-or-create against Companion) is idempotent and safe to
    // run here, outside any transaction — same reasoning as the create
    // handler. The actual link replacement is deferred and run together
    // with the `flight.update` call below inside one `prisma.$transaction`,
    // so a failure between the two never leaves the legacy array and
    // `companionLinks` disagreeing (undefined here means "untouched": the
    // companions field was not part of this update at all).
    let resolvedCompanionsForUpdate: { id: string; displayName: string }[] | undefined;
    if (data.companions !== undefined) {
      resolvedCompanionsForUpdate = await resolveCompanions(userId, data.companions);
      updateData.companions = resolvedCompanionsForUpdate.map((c) => c.displayName);
    }
    if (data.receiptUrl !== undefined) updateData.receiptUrl = data.receiptUrl;

    // Special flights (Sonder-Flüge) — explicit `null` clears, `undefined` leaves untouched
    if (data.specialType !== undefined) updateData.specialType = data.specialType;
    if (data.eventLat !== undefined) updateData.eventLat = data.eventLat;
    if (data.eventLon !== undefined) updateData.eventLon = data.eventLon;
    if (data.eventLabel !== undefined) updateData.eventLabel = data.eventLabel;
    if (data.patternLat !== undefined) updateData.patternLat = data.patternLat;
    if (data.patternLon !== undefined) updateData.patternLon = data.patternLon;
    if (data.specialData !== undefined) {
      updateData.specialData =
        data.specialData === null
          ? Prisma.JsonNull
          : (data.specialData as unknown as Prisma.InputJsonValue);
    }

    // Boarding pass / email import fields. POST writes these on create;
    // PUT must propagate them too — without this whitelist the schema
    // accepts the input, the handler silently drops it, and the user sees
    // a 200-OK with no DB change (regression report 2026-05-04).
    if (data.seatNumber !== undefined) updateData.seatNumber = data.seatNumber;
    if (data.boardingGroup !== undefined) updateData.boardingGroup = data.boardingGroup;
    if (data.gate !== undefined) updateData.gate = data.gate;
    if (data.terminal !== undefined) updateData.terminal = data.terminal;
    if (data.bookingReference !== undefined) updateData.bookingReference = data.bookingReference;
    if (data.ticketNumber !== undefined) updateData.ticketNumber = data.ticketNumber;
    if (data.baggageAllowance !== undefined) updateData.baggageAllowance = data.baggageAllowance;
    if (data.frequentFlyerNumber !== undefined)
      updateData.frequentFlyerNumber = data.frequentFlyerNumber;
    if (data.bookingClassLetter !== undefined)
      updateData.bookingClassLetter = data.bookingClassLetter;
    if (data.coPassengers !== undefined) updateData.coPassengers = data.coPassengers;
    applyExtendedFlightFields(data, updateData);
    if (data.dataSource !== undefined) updateData.dataSource = data.dataSource;
    // Direct override for time semantics. The localTime branch below sets
    // 'UTC' implicitly when a localTime is supplied; this lets bulk-import
    // callers explicitly mark a row as DATE_ONLY / UNKNOWN without changing
    // the time itself. Explicit beats implicit when both are sent.
    if (data.depTimeSemantics !== undefined) updateData.depTimeSemantics = data.depTimeSemantics;
    if (data.arrTimeSemantics !== undefined) updateData.arrTimeSemantics = data.arrTimeSemantics;

    if (enrichedDeparture) {
      updateData.depIcao = enrichedDeparture.icao;
      updateData.depIata = enrichedDeparture.iata;
      updateData.depName = enrichedDeparture.name;
      updateData.depLat = enrichedDeparture.lat;
      updateData.depLon = enrichedDeparture.lon;
    }

    if (enrichedArrival) {
      updateData.arrIcao = enrichedArrival.icao;
      updateData.arrIata = enrichedArrival.iata;
      updateData.arrName = enrichedArrival.name;
      updateData.arrLat = enrichedArrival.lat;
      updateData.arrLon = enrichedArrival.lon;
    }

    // Resolve any incoming local+tz pairs to canonical real UTC. A null pair
    // means the field was not in this update; an empty string is treated the
    // same — clients should clear actualDeparture by passing null explicitly.
    const incomingDepUtc = toUtcDate(data.departureLocal, data.depTimezone, data.departureFold);
    const incomingArrUtc = toUtcDate(data.arrivalLocal, data.arrTimezone, data.arrivalFold);
    const changed = (end: "departure" | "arrival") => airportChanged(body, end, existingFlight);
    Object.assign(
      updateData,
      await flightZoneColumns(
        data,
        {
          departure: changed("departure") ? enrichedDeparture : null,
          arrival: changed("arrival") ? enrichedArrival : null,
        },
        existingFlight,
        req
      )
    );
    const incomingActualDepUtc = toUtcDate(data.actualDepartureLocal, data.actualDepartureTz);
    const incomingActualArrUtc = toUtcDate(data.actualArrivalLocal, data.actualArrivalTz);

    if (data.departureLocal !== undefined) {
      updateData.departureTime = incomingDepUtc ?? undefined;
      // Don't overwrite an explicit semantics override the client sent.
      if (data.depTimeSemantics === undefined) {
        updateData.depTimeSemantics = "UTC";
      }
    }
    if (data.arrivalLocal !== undefined) {
      updateData.arrivalTime = incomingArrUtc ?? undefined;
      if (data.arrTimeSemantics === undefined) {
        updateData.arrTimeSemantics = "UTC";
      }
    }

    // The status field is a client-sent HINT, not the source of truth (spec
    // 2026-07-17-status-from-dates). Derive from the FINAL dep/arr values —
    // an update may move dates without sending status, or send status
    // without moving dates, so this must run after the time fields above are
    // resolved and read the resolved values, not the raw payload.
    const requestedStatus = data.status;
    const isRequestedPassthrough =
      requestedStatus !== undefined &&
      (FLIGHT_PASSTHROUGH as readonly string[]).includes(requestedStatus);
    const currentIsPassthrough = (FLIGHT_PASSTHROUGH as readonly string[]).includes(
      existingFlight.status
    );
    if (isRequestedPassthrough) {
      // Passthrough statuses are always assigned verbatim.
      updateData.status = requestedStatus!;
    } else if (requestedStatus === undefined && currentIsPassthrough) {
      // Stored status is passthrough and no status field arrived — leave it
      // alone. A bare date edit must never pull a cancelled/historical/
      // duplicated flight back into the derived scheduled/flown lifecycle.
    } else {
      const finalDep = updateData.departureTime ?? existingFlight.departureTime;
      const finalArr = updateData.arrivalTime ?? existingFlight.arrivalTime;
      updateData.status = deriveFlightStatus({
        departureTime: finalDep,
        arrivalTime: finalArr,
        current: requestedStatus ?? existingFlight.status,
      });
    }

    // Actual times and delay — one call, because either time changes the delay (AUD-021).
    const sentTimes = {
      actualDepartureSent: data.actualDepartureLocal !== undefined,
      scheduledSent: data.departureLocal !== undefined,
    };
    applyDepartureTimesAndDelay(
      sentTimes,
      {
        incomingActualDep: incomingActualDepUtc,
        incomingScheduledDep: incomingDepUtc,
        existing: existingFlight,
      },
      updateData
    );
    if (data.actualArrivalLocal !== undefined) {
      updateData.actualArrival = incomingActualArrUtc;
    }

    // Recalculate CO₂ + route distance when coordinates change or on any
    // update (always keep both in sync — same source of truth).
    const depLat = enrichedDeparture?.lat ?? existingFlight.depLat;
    const depLon = enrichedDeparture?.lon ?? existingFlight.depLon;
    const arrLat = enrichedArrival?.lat ?? existingFlight.arrLat;
    const arrLon = enrichedArrival?.lon ?? existingFlight.arrLon;
    updateData.co2Kg = calculateCo2Kg({
      depLat,
      depLon,
      arrLat,
      arrLon,
      // `!== undefined`, not `??`: an explicit null means the user CLEARED the
      // seat class, so CO₂ must recompute with the default multiplier — `??`
      // would resurrect the old class for exactly that case.
      seatClass: toSeatClass(
        data.seatClass !== undefined ? data.seatClass : existingFlight.seatClass
      ),
    });
    updateData.routeDistance = haversineKm(depLat, depLon, arrLat, arrLon);

    // Set lastModifiedBy when user updates
    updateData.lastModifiedBy = "user";

    // Recalculate smart API check schedule when departure time or status changes
    if (
      data.departureLocal !== undefined ||
      data.arrivalLocal !== undefined ||
      data.status ||
      data.flightNumber
    ) {
      const effectiveDep =
        data.departureLocal !== undefined ? incomingDepUtc : existingFlight.departureTime;
      const effectiveArr =
        data.arrivalLocal !== undefined ? incomingArrUtc : existingFlight.arrivalTime;
      // updateData.status already carries the derived value from the block
      // above (or is absent when the passthrough-preserved branch fired, in
      // which case existingFlight.status is still accurate).
      const effectiveStatus = updateData.status ?? existingFlight.status;
      const effectiveFn = data.flightNumber ?? existingFlight.flightNumber;
      updateData.nextApiCheckAt = calculateNextApiCheckAt(
        effectiveDep,
        effectiveArr,
        effectiveStatus,
        effectiveFn
      );
    }

    // FX snapshot (#267), compared with the STORED row — the edit dialog sends
    // price, currency and date on every save, so "was it sent" re-snapshotted
    // a seat change and a failed lookup wiped a good rate. See refreshOnEdit.
    const pick = <K extends "price" | "taxes" | "fees" | "currency">(k: K) =>
      data[k] !== undefined ? data[k] : existingFlight[k];
    const fx = await refreshFxOnEdit(
      {
        ...existingFlight,
        amount: flightOwnAmount(existingFlight),
        date: existingFlight.departureTime,
      },
      {
        amount: flightOwnAmount({ price: pick("price"), taxes: pick("taxes"), fees: pick("fees") }),
        currency: pick("currency") ?? null,
        date: (updateData.departureTime as Date | undefined) ?? existingFlight.departureTime,
      },
      await getBaseCurrency(userId),
      { flightId: existingFlight.id, userId }
    );
    Object.assign(updateData, fx.columns);

    const flight = await prisma.$transaction(async (tx) => {
      if (resolvedCompanionsForUpdate !== undefined) {
        await tx.flightCompanion.deleteMany({ where: { flightId: existingFlight.id } });
        if (resolvedCompanionsForUpdate.length > 0) {
          await tx.flightCompanion.createMany({
            data: linkRowsFor(resolvedCompanionsForUpdate.map((c) => c.id)).map((row) => ({
              ...row,
              flightId: existingFlight.id,
            })),
            skipDuplicates: true,
          });
        }
      }

      const before = await shareSnapshot(tx, "flight", id);
      const updated = await tx.flight.update({ where: { id, userId }, data: updateData });
      await propagateWrite(tx, userId, "flight", id, before);
      return updated;
    });

    // Check achievements if status changed to flown and return newly unlocked ones.
    // Read the PERSISTED status, not the raw `data.status` hint — status is now
    // derived (spec 2026-07-17-status-from-dates), so a date-only edit can flip
    // a flight to 'flown' with no status field in the payload at all.
    let newAchievements: Awaited<ReturnType<typeof checkAndUpdateAchievements>> = [];
    if (flight.status === "flown" && existingFlight.status !== "flown") {
      try {
        newAchievements = await checkAndUpdateAchievements(userId);
      } catch (err: unknown) {
        logger.error({
          type: "achievement_check_failed",
          userId,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    res.json({
      flight: await withAirportFacts(flight),
      newAchievements: newAchievements.length > 0 ? newAchievements : undefined,
      // "keptStoredRate" / "lookupFailed" tell the client the rate could not be refreshed.
      fxSnapshot: fx.outcome,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", deleteFlightHandler);

// Enrich a specific flight historically
router.post(
  "/:id/enrich-historical",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const { id } = req.params;

      // Check if flight exists and belongs to user
      const flight = await prisma.flight.findFirst({
        where: { id, userId },
      });

      if (!flight) {
        throw new AppError("Flight not found", 404);
      }

      // Get user settings
      const settings = await getUserEnrichmentSettings(userId);
      if (!settings || !settings.enabled) {
        throw new AppError("Historical enrichment is disabled. Enable it in settings.", 400);
      }

      if (!flight.flightNumber) {
        throw new AppError("Flight number is required for historical enrichment", 400);
      }

      // Aggregate data from similar flights — pass userId so gate/terminal come from own flights only
      const aggregatedData = await aggregateFlightData(
        flight.flightNumber,
        flight.id,
        5,
        "full",
        userId
      );

      if (!aggregatedData) {
        return res.status(404).json({
          error: "No reference flights found",
          message:
            "Could not find enough live-tracked flights with the same flight number to enrich this flight.",
        });
      }

      // Check confidence threshold
      if (aggregatedData.confidence < settings.minConfidence) {
        return res.status(400).json({
          error: "Confidence too low",
          message: `Confidence (${aggregatedData.confidence}%) is below your minimum threshold (${settings.minConfidence}%).`,
          confidence: aggregatedData.confidence,
          minConfidence: settings.minConfidence,
        });
      }

      // Create pending update
      const pendingUpdateId = await createHistoricalEnrichment(flight.id, aggregatedData, userId);

      if (!pendingUpdateId) {
        throw new AppError("Failed to create historical enrichment", 500);
      }

      res.json({
        pendingUpdateId,
        confidence: aggregatedData.confidence,
        sourceFlightsCount: aggregatedData.sourceFlightsCount,
        anomalies: aggregatedData.anomalies,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get route estimation for a flight
router.get("/:id/route-estimation", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    // Check if flight exists and belongs to user
    const flight = await prisma.flight.findFirst({
      where: { id, userId },
    });

    if (!flight) {
      throw new AppError("Flight not found", 404);
    }

    // If flight already has a route, return it
    if (flight.actualRoute && Array.isArray(flight.actualRoute) && flight.actualRoute.length > 0) {
      return res.json({
        flightId: flight.id,
        hasRoute: true,
        routeSource: flight.routeSource,
        route: flight.actualRoute,
        overflownCountries: flight.overflownCountries || [],
        routeDistance: flight.routeDistance,
      });
    }

    // Estimate route (use current time as fallback for historical flights with null departureTime)
    const estimatedRoute = estimateRoute(
      flight.depLat,
      flight.depLon,
      flight.arrLat,
      flight.arrLon,
      flight.flightNumber || "",
      flight.departureTime ?? new Date()
    );

    res.json({
      flightId: flight.id,
      hasRoute: false,
      routeSource: null,
      estimatedRoute,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
