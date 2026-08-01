import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { authenticate, requireWriteScope, AuthRequest } from '../middleware/auth';
import { createFlightSchema, updateFlightSchema, flightQuerySchema } from '../schemas/flight';
import type { FlightQueryInput } from '../schemas/flight';
import logger from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { calculateDistance, generateArcPoints } from '../utils/geo';
import { checkAndUpdateAchievements } from '../utils/achievements';
import { enrichFlightAirports } from '../services/airportLookup';
import { flightCreationLimiter, statsLimiter } from '../middleware/rateLimit';
import {
  findEnrichmentCandidates,
  getUserEnrichmentSettings,
  aggregateFlightData,
  createHistoricalEnrichment,
} from '../services/flightEnrichmentService';
import {
  countBulkRefreshCandidates,
  hasHistoricalProvider,
  runBulkRefresh,
} from '../services/bulkFlightRefresh';
import { getProviderQuota } from '../services/apiQuota';
import { estimateRoute } from '../services/routeEstimationService';
import { calculateCo2Kg, haversineKm, toSeatClass } from '../services/co2Calculator';
import { getCachedAirports } from '../services/airportCache';
import { tzAwareDurationMinutes, type FlightTimeSemantics } from '../utils/timezone';
import { fromZonedTime } from 'date-fns-tz';
import { resolveAirlineCodes } from '../utils/airlineNormalize';
import { normalizeAircraft } from '../utils/aircraftNormalize';
import { calculateNextApiCheckAt } from '../utils/smartCheckSchedule';
import { buildFlightMergePatch } from '../utils/flightMerge';
import batchRouter from './flightsBatch';
import { deriveFlightStatus, FLIGHT_PASSTHROUGH } from '../shared/statusDerivation';
import { resolveCompanions, linkRowsFor } from '../services/companionService';

const router = Router();

// Interface for flight update data
interface FlightUpdateData {
  airline?: string;
  airlineIata?: string | null;
  airlineIcao?: string | null;
  operatingAirline?: string | null;
  operatingAirlineIata?: string | null;
  operatingAirlineIcao?: string | null;
  isCodeshare?: boolean | null;
  flightNumber?: string;
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
  specialData?: Prisma.InputJsonValue | Prisma.NullTypes.JsonNull;
  // Boarding pass / email import fields — written on POST, must also be
  // updatable via PUT. Their absence here was a silent-drop bug.
  seatNumber?: string;
  boardingGroup?: string;
  gate?: string;
  terminal?: string;
  bookingReference?: string;
  ticketNumber?: string;
  baggageAllowance?: string;
  frequentFlyerNumber?: string;
  bookingClassLetter?: string;
  coPassengers?: string[];
  dataSource?: string;
}

// Resolve a paired (local wall-clock + IANA timezone) input into a real UTC
// instant. Returns null when either side is missing — schema validation has
// already enforced that a present local string requires a timezone.
function toUtcDate(local: string | null | undefined, tz: string | null | undefined): Date | null {
  if (!local || !tz) return null;
  return fromZonedTime(local, tz);
}

// All routes require authentication.
// `requireWriteScope` is method-aware: GET/HEAD/OPTIONS pass through, anything
// else demands a write- or admin-scoped PAT (cookie sessions are unaffected).
// Order matters — must run before the batchRouter mount so /flights/batch
// inherits the same scope check.
router.use(authenticate);
router.use(requireWriteScope);
router.use(batchRouter);

// Normalize query params coming from axios (arrays are sent as foo[] by default)
const normalizeQueryParams = (query: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> => {
  const normalized: Record<string, string | string[] | undefined> = {};

  Object.entries(query).forEach(([key, value]) => {
    const normalizedKey = key.endsWith('[]') ? key.slice(0, -2) : key;
    normalized[normalizedKey] = value;
  });

  return normalized;
};

// Convert a potentially pipe/comma separated string or array into a clean string array
const splitMultiValue = (value?: string | string[]) => {
  if (!value) return [];

  const raw = Array.isArray(value) ? value : value.split(',');

  return raw
    .flatMap(v => v.split('|'))
    .map(v => v.trim())
    .filter(Boolean);
};

const buildFlightWhere = (
  query: (FlightQueryInput & { tags?: string[] }),
  userId: string
) => {
  const andConditions: Prisma.FlightWhereInput[] = [{ userId }];
  let noResults = false;

  // Airlines (allow multiple selections)
  const airlines = splitMultiValue(query.airline);
  if (airlines.length === 1) {
    andConditions.push({ airline: { contains: airlines[0], mode: 'insensitive' } });
  } else if (airlines.length > 1) {
    andConditions.push({
      OR: airlines.map(airline => ({
        airline: { contains: airline, mode: 'insensitive' },
      })),
    });
  }

  if (query.flightNumber) {
    andConditions.push({ flightNumber: { contains: query.flightNumber, mode: 'insensitive' } });
  }

  if (query.departureAirport) {
    andConditions.push({
      OR: [
        { depIata: { contains: query.departureAirport, mode: 'insensitive' } },
        { depIcao: { contains: query.departureAirport, mode: 'insensitive' } },
        { depName: { contains: query.departureAirport, mode: 'insensitive' } },
      ],
    });
  }

  if (query.arrivalAirport) {
    andConditions.push({
      OR: [
        { arrIata: { contains: query.arrivalAirport, mode: 'insensitive' } },
        { arrIcao: { contains: query.arrivalAirport, mode: 'insensitive' } },
        { arrName: { contains: query.arrivalAirport, mode: 'insensitive' } },
      ],
    });
  }

  // Status (allow multiple selections, explicit empty means no results)
  const statuses = splitMultiValue(query.status) as Array<
    'scheduled' | 'flown' | 'cancelled' | 'historical' | 'duplicated'
  >;
  if (Array.isArray(query.status) && query.status.length === 0) {
    noResults = true;
  } else if (statuses.length === 1) {
    andConditions.push({ status: statuses[0] });
  } else if (statuses.length > 1) {
    andConditions.push({ status: { in: statuses } });
  }

  if (query.category) {
    andConditions.push({ category: query.category });
  }

  // Tags
  const tags = query.tags || [];
  if (tags.length > 0) {
    andConditions.push({ tags: { hasEvery: tags } });
  }

  // Price range
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const price: Prisma.FloatNullableFilter = {};
    if (query.minPrice !== undefined) price.gte = query.minPrice;
    if (query.maxPrice !== undefined) price.lte = query.maxPrice;
    andConditions.push({ price });
  }

  // Date range
  if (query.fromDate || query.toDate) {
    const departureTime: Prisma.DateTimeFilter = {};
    if (query.fromDate) departureTime.gte = new Date(query.fromDate);
    if (query.toDate) departureTime.lte = new Date(query.toDate);
    andConditions.push({ departureTime });
  }

  return {
    where: { AND: andConditions },
    noResults,
  };
};

// Create flight (rate limited to prevent abuse)
router.post('/', flightCreationLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const data = createFlightSchema.parse(req.body);

    // Soft warning for past-dated `scheduled` rows (G4) — not rejected so
    // legitimate edge cases (manually re-edited just-departed rows) still
    // succeed, but flagged for ops review since these are almost always a
    // status-flip bug or a year-typo in bulk imports.
    if (data.status === 'scheduled' && data.departureLocal) {
      const nowIso = new Date().toISOString().slice(0, 19);
      if (data.departureLocal < nowIso) {
        logger.warn({
          operation: 'flight_create_scheduled_in_past',
          userId,
          departureLocal: data.departureLocal,
          flightNumber: data.flightNumber,
        });
      }
    }

    const departureUtc = toUtcDate(data.departureLocal, data.depTimezone);
    const arrivalUtc = toUtcDate(data.arrivalLocal, data.arrTimezone);
    const actualDepartureUtc = toUtcDate(data.actualDepartureLocal, data.actualDepartureTz);
    const actualArrivalUtc = toUtcDate(data.actualArrivalLocal, data.actualArrivalTz);

    // The status field is a client-sent HINT, not the source of truth (spec
    // 2026-07-17-status-from-dates) — passthrough statuses (cancelled,
    // historical, duplicated) are assigned verbatim, everything else is
    // derived from the actual departure/arrival dates being written.
    const effectiveStatus = (FLIGHT_PASSTHROUGH as readonly string[]).includes(data.status ?? '')
      ? data.status!
      : deriveFlightStatus({
          departureTime: departureUtc,
          arrivalTime: arrivalUtc,
          current: data.status ?? 'scheduled',
        });

    // Resolve airline codes if name provided but IATA/ICAO missing
    let airlineIata = data.airlineIata;
    let airlineIcao = data.airlineIcao;
    if (data.airline && !airlineIata && !airlineIcao) {
      const resolved = resolveAirlineCodes(data.airline);
      if (resolved) {
        airlineIata = resolved.iata ?? null;
        airlineIcao = resolved.icao ?? null;
      }
    }

    // Duplicate check (#84): pre-existing rows can hold non-canonical
    // flightNumber strings ("LH 123", "lh123") from before the schema-level
    // normalization landed, so fetch the day's candidates and compare
    // normalized in JS rather than relying on a direct WHERE.
    //
    // ?force=true → bypass and create a real duplicate row (user opt-in).
    // ?merge=true → fill missing fields on the existing flight from
    //   incoming data without ever overwriting curated values; lets a
    //   second source (boarding pass, email confirmation) enrich a
    //   manually-entered flight in place. force wins if both are set.
    const forceCreate = req.query['force'] === 'true';
    const mergeIntoExisting = !forceCreate && req.query['merge'] === 'true';
    if (data.flightNumber && !forceCreate && departureUtc) {
      const dayStart = new Date(departureUtc);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(departureUtc);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const dayCandidates = await prisma.flight.findMany({
        where: {
          userId,
          departureTime: { gte: dayStart, lte: dayEnd },
        },
        select: {
          id: true,
          flightNumber: true,
          airline: true,
          depIata: true,
          arrIata: true,
          departureTime: true,
        },
      });

      const normalize = (s: string | null): string =>
        (s ?? '').replace(/\s+/g, '').toUpperCase();
      const wantFlightNumber = data.flightNumber; // already normalized by schema
      const existing = dayCandidates.find(
        (c) => normalize(c.flightNumber) === wantFlightNumber
      );

      if (existing) {
        if (mergeIntoExisting) {
          const existingFull = await prisma.flight.findUnique({
            where: { id: existing.id },
          });
          if (!existingFull) {
            res.status(409).json({
              error: 'DUPLICATE_FLIGHT',
              message: `Flight ${data.flightNumber} on this day already exists`,
              existingFlight: existing,
            });
            return;
          }
          const { patch, mergedFields } = buildFlightMergePatch(existingFull, data);
          const merged = mergedFields.length === 0
            ? existingFull
            : await prisma.flight.update({
                where: { id: existing.id },
                data: { ...patch, lastModifiedBy: 'user' },
              });
          res.status(200).json({
            flight: merged,
            mergedFields,
          });
          return;
        }

        res.status(409).json({
          error: 'DUPLICATE_FLIGHT',
          message: `Flight ${data.flightNumber} on this day already exists`,
          existingFlight: existing,
        });
        return;
      }
    }

    // Enrich airport data with missing information from database
    const enriched = await enrichFlightAirports({
      departure: {
        iata: data.departure.iata ?? undefined,
        icao: data.departure.icao ?? undefined,
        name: data.departure.name ?? undefined,
        lat: data.departure.lat,
        lon: data.departure.lon,
      },
      arrival: {
        iata: data.arrival.iata ?? undefined,
        icao: data.arrival.icao ?? undefined,
        name: data.arrival.name ?? undefined,
        lat: data.arrival.lat,
        lon: data.arrival.lon,
      },
    });

    // Resolve companion names to Companion entities up front (find-or-create
    // is idempotent via companionService, so it's safe to run outside the
    // transaction below). The flight row and its links are written together
    // inside a transaction so a failure never leaves the legacy `companions`
    // array and the `companionLinks` table disagreeing.
    const companionNames = data.companions ?? [];
    const resolvedCompanions = await resolveCompanions(userId, companionNames);

    const flight = await prisma.$transaction(async (tx) => {
      const created = await tx.flight.create({
      data: {
        userId,
        airline: data.airline,
        airlineIata,
        airlineIcao,
        operatingAirline: data.operatingAirline,
        operatingAirlineIata: data.operatingAirlineIata,
        operatingAirlineIcao: data.operatingAirlineIcao,
        isCodeshare: data.isCodeshare,
        flightNumber: data.flightNumber,
        callsign: data.callsign,
        aircraft: data.aircraft ? normalizeAircraft(data.aircraft) : null,
        aircraftRegistration: data.aircraftRegistration,
        aircraftModeS: data.aircraftModeS,
        // Use enriched departure data (fills in missing IATA/ICAO/names)
        depIcao: enriched.departure.icao,
        depIata: enriched.departure.iata,
        depName: enriched.departure.name,
        depLat: enriched.departure.lat,
        depLon: enriched.departure.lon,
        // Use enriched arrival data (fills in missing IATA/ICAO/names)
        arrIcao: enriched.arrival.icao,
        arrIata: enriched.arrival.iata,
        arrName: enriched.arrival.name,
        arrLat: enriched.arrival.lat,
        arrLon: enriched.arrival.lon,
        departureTime: departureUtc,
        arrivalTime: arrivalUtc,
        actualDeparture: actualDepartureUtc,
        actualArrival: actualArrivalUtc,
        // Default to 'UTC' (the canonical contract). Bulk-import callers can
        // override with 'DATE_ONLY' or 'UNKNOWN' when the time component is
        // a placeholder so downstream display/aggregation knows to estimate.
        depTimeSemantics: data.depTimeSemantics ?? 'UTC',
        arrTimeSemantics: data.arrTimeSemantics ?? 'UTC',
        delayMinutes:
          actualDepartureUtc && departureUtc
            ? Math.round((actualDepartureUtc.getTime() - departureUtc.getTime()) / 60000)
            : null,
        co2Kg: calculateCo2Kg({
          depLat: enriched.departure.lat,
          depLon: enriched.departure.lon,
          arrLat: enriched.arrival.lat,
          arrLon: enriched.arrival.lon,
          seatClass: toSeatClass(data.seatClass),
        }),
        // Haversine route distance — see flightsBatch.ts for context.
        routeDistance: haversineKm(
          enriched.departure.lat,
          enriched.departure.lon,
          enriched.arrival.lat,
          enriched.arrival.lon,
        ),
        status: effectiveStatus,
        notes: data.notes,
        price: data.price,
        taxes: data.taxes,
        fees: data.fees,
        currency: data.currency,
        category: data.category,
        tags: data.tags ?? [],
        // Dual write: resolved display names keep this legacy array in
        // agreement with `companionLinks` below (trimmed, blanks dropped,
        // newest spelling wins) — the previous image still reads this column.
        companions: resolvedCompanions.map((c) => c.displayName),
        receiptUrl: data.receiptUrl,
        // Boarding pass / email import fields
        seatNumber: data.seatNumber,
        boardingGroup: data.boardingGroup,
        gate: data.gate,
        terminal: data.terminal,
        bookingReference: data.bookingReference,
        ticketNumber: data.ticketNumber,
        baggageAllowance: data.baggageAllowance,
        frequentFlyerNumber: data.frequentFlyerNumber,
        bookingClassLetter: data.bookingClassLetter,
        coPassengers: data.coPassengers ?? [],
        // Data source tracking
        dataSource: data.dataSource ?? 'manual',
        lastModifiedBy: 'user',
        nextApiCheckAt: calculateNextApiCheckAt(
          departureUtc,
          arrivalUtc,
          effectiveStatus,
          data.flightNumber,
        ),
        // Special flights (Sonder-Flüge) — non-null specialType marks
        // this flight as a sub-type. See schemas/flight.ts for the union.
        specialType: data.specialType ?? null,
        eventLat: data.eventLat ?? null,
        eventLon: data.eventLon ?? null,
        eventLabel: data.eventLabel ?? null,
        patternLat: data.patternLat ?? null,
        patternLon: data.patternLon ?? null,
        specialData:
          data.specialData === null || data.specialData === undefined
            ? Prisma.JsonNull
            : (data.specialData as unknown as Prisma.InputJsonValue),
      },
      });

      if (resolvedCompanions.length > 0) {
        await tx.flightCompanion.createMany({
          data: linkRowsFor(resolvedCompanions.map((c) => c.id)).map((row) => ({
            ...row,
            flightId: created.id,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    // Check achievements after creating a flight and return newly unlocked ones
    let newAchievements: Awaited<ReturnType<typeof checkAndUpdateAchievements>> = [];
    if (flight) {
      try {
        newAchievements = await checkAndUpdateAchievements(userId);
      } catch (err: unknown) {
        logger.error({ type: 'achievement_check_failed', userId, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    res.status(201).json({
      flight,
      newAchievements: newAchievements.length > 0 ? newAchievements : undefined
    });
  } catch (error) {
    next(error);
  }
});

// Get flights with filters
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const normalizedQuery = normalizeQueryParams(req.query as Record<string, string | string[] | undefined>);
    const parsedQuery = flightQuerySchema.parse(normalizedQuery);
    const tagsArray = splitMultiValue(parsedQuery.tags as string | string[] | undefined);
    // ?all=true bypasses the 500-row cap entirely so API consumers can sync
    // the full row set in one request. Auth + user-scoped where clause make
    // an unbounded read safe; the only consumer is the row owner.
    const all = parsedQuery.all === true;
    const cappedLimit = Math.min(parsedQuery.limit ?? 100, 500);
    const query = {
      ...parsedQuery,
      tags: tagsArray,
      limit: cappedLimit,
      offset: all ? 0 : parsedQuery.offset,
    };
    const take = all ? undefined : cappedLimit;
    const { where, noResults } = buildFlightWhere(query, userId);

    if (noResults) {
      return res.json({
        flights: [],
        total: 0,
        limit: take ?? 0,
        offset: query.offset,
        all,
      });
    }

    const [flights, total] = await Promise.all([
      prisma.flight.findMany({
        where,
        // Deterministic tie-breaker: departureTime is nullable and not unique,
        // so paginating on it alone (skip/take) can skip or duplicate rows at
        // page boundaries. The id keeps the total order stable.
        orderBy: [{ departureTime: 'desc' }, { id: 'asc' }],
        skip: query.offset,
        take,
        include: {
          trip: { select: { id: true, name: true, color: true } },
        },
      }),
      prisma.flight.count({ where }),
    ]);

    // Enrich flights with timezone-aware duration
    const allCodes = new Set<string>();
    for (const f of flights) {
      if (f.depIata) allCodes.add(f.depIata);
      if (f.depIcao) allCodes.add(f.depIcao);
      if (f.arrIata) allCodes.add(f.arrIata);
      if (f.arrIcao) allCodes.add(f.arrIcao);
    }
    let tzMap = new Map<string, string>();
    const countryMap = new Map<string, string>();
    try {
      const airports = await getCachedAirports(Array.from(allCodes));
      for (const [code, data] of airports.entries()) {
        if (data?.timezone) tzMap.set(code, data.timezone);
        if (data?.country) countryMap.set(code, data.country);
      }
    } catch { /* timezone lookup failed — durations use naïve diff */ }

    const enrichedFlights = flights.map(f => {
      const depTz = (f.depIata && tzMap.get(f.depIata))
        || (f.depIcao && tzMap.get(f.depIcao))
        || null;
      const arrTz = (f.arrIata && tzMap.get(f.arrIata))
        || (f.arrIcao && tzMap.get(f.arrIcao))
        || null;
      const rawDuration = (f.departureTime && f.arrivalTime)
        ? tzAwareDurationMinutes(
            f.departureTime,
            f.arrivalTime,
            depTz,
            arrTz,
            f.depTimeSemantics as FlightTimeSemantics,
            f.arrTimeSemantics as FlightTimeSemantics,
          )
        : null;
      // null = DATE_ONLY semantics (issue #106A) — display layer renders
      // a great-circle estimate instead of the placeholder-time duration.
      return {
        ...f,
        durationMinutes: rawDuration === null ? null : Math.round(rawDuration),
        depCountry: (f.depIata && countryMap.get(f.depIata)) || (f.depIcao && countryMap.get(f.depIcao)) || null,
        arrCountry: (f.arrIata && countryMap.get(f.arrIata)) || (f.arrIcao && countryMap.get(f.arrIcao)) || null,
        depTimezone: depTz,
        arrTimezone: arrTz,
      };
    });

    res.json({
      flights: enrichedFlights,
      total,
      limit: take ?? total,
      offset: query.offset,
      all,
    });
  } catch (error) {
    next(error);
  }
});

// Get flights as GeoJSON
router.get('/geo', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const normalizedQuery = normalizeQueryParams(req.query as Record<string, string | string[] | undefined>);
    const parsedQuery = flightQuerySchema.parse(normalizedQuery);
    const tagsArray = splitMultiValue(parsedQuery.tags as string | string[] | undefined);
    const query = {
      ...parsedQuery,
      tags: tagsArray,
      limit: Math.min(parsedQuery.limit ?? 100, 500),
    };
    const { where, noResults } = buildFlightWhere(query, userId);

    if (noResults) {
      return res.json({
        type: 'FeatureCollection',
        features: [],
      });
    }

    const flights = await prisma.flight.findMany({
      where,
      // Deterministic tie-breaker: departureTime is nullable and not unique, so
      // paginating getAllGeoJSON on it alone would skip/duplicate rows at the
      // 500-row page boundaries. The id keeps the total order stable, so every
      // flight is plotted exactly once across all pages.
      orderBy: [{ departureTime: 'desc' }, { id: 'asc' }],
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
    if (iatas.size > 0 || icaos.size > 0) {
      const airports = await prisma.airport.findMany({
        where: {
          OR: [{ iata: { in: [...iatas] } }, { icao: { in: [...icaos] } }],
        },
        select: { iata: true, icao: true, country: true, city: true },
      });
      for (const a of airports) {
        const info: AirportInfo = { country: a.country ?? null, city: a.city ?? null };
        if (a.iata) infoByIata.set(a.iata, info);
        if (a.icao) infoByIcao.set(a.icao, info);
      }
    }
    const airportInfo = (iata: string | null, icao: string | null): AirportInfo =>
      (iata ? infoByIata.get(iata) : undefined) ??
      (icao ? infoByIcao.get(icao) : undefined) ?? { country: null, city: null };

    const features = flights.map(flight => {
      const arcPoints = generateArcPoints(
        [flight.depLon, flight.depLat],
        [flight.arrLon, flight.arrLat]
      );

      return {
        type: 'Feature',
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
          distance: calculateDistance(
            flight.depLat,
            flight.depLon,
            flight.arrLat,
            flight.arrLon
          ),
        },
        geometry: {
          type: 'LineString',
          coordinates: arcPoints,
        },
      };
    });

    res.json({
      type: 'FeatureCollection',
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
router.get('/refresh-historical-bulk/preview', flightCreationLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isDemo: true },
    });
    if (user?.isDemo) {
      return res.status(403).json({
        error: 'DEMO_ACCOUNT_FORBIDDEN',
        message:
          'Bulk refresh is disabled for the demo account to keep RapidAPI quota intact. Use a real account on a production deployment.',
      });
    }
    const [remaining, hasProvider] = await Promise.all([
      countBulkRefreshCandidates(userId),
      hasHistoricalProvider(userId),
    ]);
    const adbQuota = getProviderQuota('aerodatabox', userId);
    const quota = adbQuota.kind === 'observed' ? adbQuota : null;
    res.json({
      remaining,
      hasHistoricalProvider: hasProvider,
      aerodataboxQuota: quota,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/refresh-historical-bulk', flightCreationLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isDemo: true },
    });
    if (user?.isDemo) {
      return res.status(403).json({
        error: 'DEMO_ACCOUNT_FORBIDDEN',
        message:
          'Bulk refresh is disabled for the demo account to keep RapidAPI quota intact. Use a real account on a production deployment.',
      });
    }

    if (!(await hasHistoricalProvider(userId))) {
      return res.status(409).json({
        error: 'NO_HISTORICAL_PROVIDER',
        message:
          'Bulk refresh needs an AeroDataBox or Aviationstack key to look up flights older than today. Configure one in the API keys section above.',
      });
    }

    const summary = await runBulkRefresh(userId);
    const adbQuota = getProviderQuota('aerodatabox', userId);
    const quota = adbQuota.kind === 'observed' ? adbQuota : null;
    res.json({ ...summary, aerodataboxQuota: quota });
  } catch (error) {
    next(error);
  }
});

// Get enrichment candidates
router.get('/enrichment-candidates', statsLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const rawLimit = req.query.limit;
    const limit = rawLimit !== undefined
      ? Math.min(500, Math.max(1, parseInt(String(rawLimit), 10) || 10))
      : undefined;

    // Get user settings
    const settings = await getUserEnrichmentSettings(userId);
    if (!settings || !settings.enabled) {
      return res.json({
        candidates: [],
        settings: null,
        message: 'Historical enrichment is disabled. Enable it in settings.',
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
});

// Get a single flight by id — added for API consumers (AI agents,
// scripts) that PATCH/PUT and want to read back the freshly-updated
// state without re-listing every flight. Returns the flight directly
// (not wrapped) so curl-piped jq filters stay simple.
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const flight = await prisma.flight.findFirst({ where: { id, userId } });
    if (!flight) {
      throw new AppError('Flight not found', 404);
    }
    res.json(flight);
  } catch (error) {
    next(error);
  }
});

// Update flight
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const data = updateFlightSchema.parse(req.body);

    // Check if flight exists and belongs to user
    const existingFlight = await prisma.flight.findFirst({
      where: { id, userId },
    });

    if (!existingFlight) {
      throw new AppError('Flight not found', 404);
    }

    // Enrich airport data if departure or arrival is being updated.
    // Use immutable references — never mutate the Zod-parsed `data` object.
    let enrichedDeparture = data.departure ?? null;
    let enrichedArrival = data.arrival ?? null;

    if (data.departure || data.arrival) {
      const enriched = await enrichFlightAirports({
        departure: data.departure ? {
          iata: data.departure.iata ?? undefined,
          icao: data.departure.icao ?? undefined,
          name: data.departure.name ?? undefined,
          lat: data.departure.lat,
          lon: data.departure.lon,
        } : {
          iata: existingFlight.depIata ?? undefined,
          icao: existingFlight.depIcao ?? undefined,
          name: existingFlight.depName ?? undefined,
          lat: existingFlight.depLat,
          lon: existingFlight.depLon,
        },
        arrival: data.arrival ? {
          iata: data.arrival.iata ?? undefined,
          icao: data.arrival.icao ?? undefined,
          name: data.arrival.name ?? undefined,
          lat: data.arrival.lat,
          lon: data.arrival.lon,
        } : {
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
    if (data.airline) updateData.airline = data.airline;
    
    // Resolve airline codes if name provided but IATA/ICAO missing
    let airlineIata = data.airlineIata;
    let airlineIcao = data.airlineIcao;
    if (data.airline && airlineIata === undefined && airlineIcao === undefined) {
      const resolved = resolveAirlineCodes(data.airline);
      if (resolved) {
        airlineIata = resolved.iata ?? null;
        airlineIcao = resolved.icao ?? null;
      }
    }
    if (airlineIata !== undefined) updateData.airlineIata = airlineIata;
    if (airlineIcao !== undefined) updateData.airlineIcao = airlineIcao;
    if (data.operatingAirline !== undefined) updateData.operatingAirline = data.operatingAirline;
    if (data.operatingAirlineIata !== undefined) updateData.operatingAirlineIata = data.operatingAirlineIata;
    if (data.operatingAirlineIcao !== undefined) updateData.operatingAirlineIcao = data.operatingAirlineIcao;
    if (data.isCodeshare !== undefined) updateData.isCodeshare = data.isCodeshare;
    if (data.flightNumber) updateData.flightNumber = data.flightNumber;
    if (data.callsign !== undefined) updateData.callsign = data.callsign;
    if (data.aircraft !== undefined) updateData.aircraft = data.aircraft ? normalizeAircraft(data.aircraft) : data.aircraft;
    if (data.aircraftRegistration !== undefined) updateData.aircraftRegistration = data.aircraftRegistration;
    if (data.aircraftModeS !== undefined) updateData.aircraftModeS = data.aircraftModeS;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.price !== undefined) updateData.price = data.price;
    if (data.taxes !== undefined) updateData.taxes = data.taxes;
    if (data.fees !== undefined) updateData.fees = data.fees;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.seatClass !== undefined) updateData.seatClass = data.seatClass;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.companions !== undefined) {
      // Replace rather than append — an update always carries the FULL
      // companion list for the flight, so stale links must go. No
      // surrounding transaction here (unlike the create handler); a failure
      // between the delete and the create leaves links briefly empty, which
      // self-heals on the next successful update.
      const resolved = await resolveCompanions(userId, data.companions);
      await prisma.flightCompanion.deleteMany({ where: { flightId: existingFlight.id } });
      if (resolved.length > 0) {
        await prisma.flightCompanion.createMany({
          data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
            ...row,
            flightId: existingFlight.id,
          })),
          skipDuplicates: true,
        });
      }
      // Dual write: the previous image still reads this column.
      updateData.companions = resolved.map((c) => c.displayName);
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
    if (data.frequentFlyerNumber !== undefined) updateData.frequentFlyerNumber = data.frequentFlyerNumber;
    if (data.bookingClassLetter !== undefined) updateData.bookingClassLetter = data.bookingClassLetter;
    if (data.coPassengers !== undefined) updateData.coPassengers = data.coPassengers;
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
    const incomingDepUtc = toUtcDate(data.departureLocal, data.depTimezone);
    const incomingArrUtc = toUtcDate(data.arrivalLocal, data.arrTimezone);
    const incomingActualDepUtc = toUtcDate(data.actualDepartureLocal, data.actualDepartureTz);
    const incomingActualArrUtc = toUtcDate(data.actualArrivalLocal, data.actualArrivalTz);

    if (data.departureLocal !== undefined) {
      updateData.departureTime = incomingDepUtc ?? undefined;
      // Don't overwrite an explicit semantics override the client sent.
      if (data.depTimeSemantics === undefined) {
        updateData.depTimeSemantics = 'UTC';
      }
    }
    if (data.arrivalLocal !== undefined) {
      updateData.arrivalTime = incomingArrUtc ?? undefined;
      if (data.arrTimeSemantics === undefined) {
        updateData.arrTimeSemantics = 'UTC';
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
      existingFlight.status,
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

    // Actual times and delay
    if (data.actualDepartureLocal !== undefined) {
      updateData.actualDeparture = incomingActualDepUtc;
      const scheduledDep: Date | null = incomingDepUtc ?? existingFlight.departureTime;
      updateData.delayMinutes = incomingActualDepUtc && scheduledDep
        ? Math.round((incomingActualDepUtc.getTime() - scheduledDep.getTime()) / 60000)
        : null;
    }
    if (data.actualArrivalLocal !== undefined) {
      updateData.actualArrival = incomingActualArrUtc;
    }

    // Recalculate CO₂ + route distance when coordinates change or on any
    // update (always keep both in sync — same source of truth).
    const depLat = enrichedDeparture?.lat ?? existingFlight.depLat;
    const depLon = enrichedDeparture?.lon ?? existingFlight.depLon;
    const arrLat = enrichedArrival?.lat  ?? existingFlight.arrLat;
    const arrLon = enrichedArrival?.lon  ?? existingFlight.arrLon;
    updateData.co2Kg = calculateCo2Kg({
      depLat,
      depLon,
      arrLat,
      arrLon,
      seatClass: toSeatClass(data.seatClass ?? existingFlight.seatClass),
    });
    updateData.routeDistance = haversineKm(depLat, depLon, arrLat, arrLon);

    // Set lastModifiedBy when user updates
    updateData.lastModifiedBy = 'user';

    // Recalculate smart API check schedule when departure time or status changes
    if (
      data.departureLocal !== undefined ||
      data.arrivalLocal !== undefined ||
      data.status ||
      data.flightNumber
    ) {
      const effectiveDep = data.departureLocal !== undefined
        ? incomingDepUtc
        : existingFlight.departureTime;
      const effectiveArr = data.arrivalLocal !== undefined
        ? incomingArrUtc
        : existingFlight.arrivalTime;
      // updateData.status already carries the derived value from the block
      // above (or is absent when the passthrough-preserved branch fired, in
      // which case existingFlight.status is still accurate).
      const effectiveStatus = updateData.status ?? existingFlight.status;
      const effectiveFn = data.flightNumber ?? existingFlight.flightNumber;
      updateData.nextApiCheckAt = calculateNextApiCheckAt(
        effectiveDep,
        effectiveArr,
        effectiveStatus,
        effectiveFn,
      );
    }

    const flight = await prisma.flight.update({
      where: { id, userId },
      data: updateData,
    });

    // Check achievements if status changed to flown and return newly unlocked ones.
    // Read the PERSISTED status, not the raw `data.status` hint — status is now
    // derived (spec 2026-07-17-status-from-dates), so a date-only edit can flip
    // a flight to 'flown' with no status field in the payload at all.
    let newAchievements: Awaited<ReturnType<typeof checkAndUpdateAchievements>> = [];
    if (flight.status === 'flown' && existingFlight.status !== 'flown') {
      try {
        newAchievements = await checkAndUpdateAchievements(userId);
      } catch (err: unknown) {
        logger.error({ type: 'achievement_check_failed', userId, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    res.json({
      flight,
      newAchievements: newAchievements.length > 0 ? newAchievements : undefined
    });
  } catch (error) {
    next(error);
  }
});

// Delete flight
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    // Check if flight exists and belongs to user
    const existingFlight = await prisma.flight.findFirst({
      where: { id, userId },
    });

    if (!existingFlight) {
      throw new AppError('Flight not found', 404);
    }

    await prisma.flight.delete({
      where: { id, userId },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Enrich a specific flight historically
router.post('/:id/enrich-historical', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    // Check if flight exists and belongs to user
    const flight = await prisma.flight.findFirst({
      where: { id, userId },
    });

    if (!flight) {
      throw new AppError('Flight not found', 404);
    }

    // Get user settings
    const settings = await getUserEnrichmentSettings(userId);
    if (!settings || !settings.enabled) {
      throw new AppError('Historical enrichment is disabled. Enable it in settings.', 400);
    }

    if (!flight.flightNumber) {
      throw new AppError('Flight number is required for historical enrichment', 400);
    }

    // Aggregate data from similar flights — pass userId so gate/terminal come from own flights only
    const aggregatedData = await aggregateFlightData(flight.flightNumber, flight.id, 5, 'full', userId);

    if (!aggregatedData) {
      return res.status(404).json({
        error: 'No reference flights found',
        message: 'Could not find enough live-tracked flights with the same flight number to enrich this flight.',
      });
    }

    // Check confidence threshold
    if (aggregatedData.confidence < settings.minConfidence) {
      return res.status(400).json({
        error: 'Confidence too low',
        message: `Confidence (${aggregatedData.confidence}%) is below your minimum threshold (${settings.minConfidence}%).`,
        confidence: aggregatedData.confidence,
        minConfidence: settings.minConfidence,
      });
    }

    // Create pending update
    const pendingUpdateId = await createHistoricalEnrichment(flight.id, aggregatedData, userId);

    if (!pendingUpdateId) {
      throw new AppError('Failed to create historical enrichment', 500);
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
});

// Get route estimation for a flight
router.get('/:id/route-estimation', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    // Check if flight exists and belongs to user
    const flight = await prisma.flight.findFirst({
      where: { id, userId },
    });

    if (!flight) {
      throw new AppError('Flight not found', 404);
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
      flight.flightNumber || '',
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
