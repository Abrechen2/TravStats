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
import { flightQuerySchema } from "../schemas/flight";
import { AppError } from "../middleware/errorHandler";
import { type ExtendedFlightInput } from "../services/flights/extendedFlightFields";
import { calculateDistance, generateArcPoints } from "../utils/geo";
import { flightCreationLimiter, statsLimiter } from "../middleware/rateLimit";
import {
  findEnrichmentCandidates,
  getUserEnrichmentSettings,
  aggregateFlightData,
  createHistoricalEnrichment,
} from "../services/flightEnrichmentService";
import { enrichmentRefusal } from "../services/flightEnrichmentRefusal";
import {
  countBulkRefreshCandidates,
  hasHistoricalProvider,
  runBulkRefresh,
} from "../services/bulkFlightRefresh";
import { getProviderQuota } from "../services/apiQuota";
import { compareAirportAuthority } from "../services/airportCache";
import {
  enrichFlightsForClients,
  type AirportFacts,
  type ClientFlight,
} from "../services/flightAirportFacts";
import {
  buildAirportCoordinateIndex,
  resolveAirportCoordinate,
} from "../services/airportCoordinates";
import batchRouter from "./flightsBatch";
import { updateFlightHandler } from "./flights/update";

const router = Router();

// Interface for flight update data
export interface FlightUpdateData extends ExtendedFlightInput {
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
      omit: { actualRoute: true, enrichmentHistory: true }, // heavy JSON the map never reads (forgejo#338)
      // Tie-breaker: departureTime is nullable and not unique, so paging on it
      // alone would skip/duplicate rows at the 500-row boundaries; the id keeps
      // the order total, so every flight is plotted exactly once.
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
      include: {
        trip: { select: { id: true, name: true, color: true } },
        // The Rail&Fly tickets that feed this flight (owner ruling 2026-11-05).
        railAndFlyRides: {
          select: {
            id: true,
            depStationName: true,
            arrStationName: true,
            departureTime: true,
            trainNumber: true,
          },
          orderBy: { departureTime: "asc" },
        },
      },
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
router.put("/:id", updateFlightHandler);

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
        throw enrichmentRefusal("ENRICH_DISABLED");
      }

      if (!flight.flightNumber) {
        throw enrichmentRefusal("ENRICH_NO_FLIGHT_NUMBER");
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
        throw enrichmentRefusal("ENRICH_NO_REFERENCE");
      }

      // Check confidence threshold
      if (aggregatedData.confidence < settings.minConfidence) {
        throw enrichmentRefusal("ENRICH_CONFIDENCE_LOW", {
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

// `GET /:id/route-estimation` was retired (forgejo#407, owner decision 2026-10-29):
// no client called it, and the flight itself already carries what it served —
// `actualRoute`, `routeSource`, `routeDistance` and `overflownCountries` ride on
// `GET /flights/:id`, and the map reads its arcs from `/flights/geojson`.

export default router;
