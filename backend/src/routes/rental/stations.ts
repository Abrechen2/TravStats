import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { rentalStationSearchLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { rentalStationSearchSchema } from "../../schemas/rental";

/**
 * The rental station typeahead (spec 2026-10-01-rental-domain-design §3.2,
 * §5): every airport the query names and every station the user has rented
 * from before. There is no catalogue of rental counters; an address that is
 * neither goes through the geocoder search the form already has.
 *
 * Silent-failure class 1: nothing here is a subset of a derived collection —
 * airports come from the catalogue itself, earlier stations from the user's
 * own rows, both ends of every rental.
 *
 * Mounted at /api/v1/rentals/stations, ahead of the rental router, whose
 * `/:id` would otherwise take "stations" for a rental id.
 */
const router = Router();
router.use(authenticate);

export interface RentalStationHit {
  kind: "airport" | "earlier";
  airportId: number | null;
  iata: string | null;
  name: string;
  address: string | null;
  city: string | null;
  lat: number;
  lon: number;
  country: string | null;
  timezone: string | null;
}

async function airportHits(q: string, limit: number): Promise<RentalStationHit[]> {
  const exact = await prisma.airport.findMany({
    where: {
      isClosed: false,
      OR: [
        { iata: { equals: q, mode: "insensitive" } },
        { icao: { equals: q, mode: "insensitive" } },
      ],
    },
  });
  const partial = await prisma.airport.findMany({
    where: {
      isClosed: false,
      id: { notIn: exact.map((a) => a.id) },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { municipalityName: { contains: q, mode: "insensitive" } },
      ],
    },
    // Airports with an IATA code first — a rental counter sits at one of those.
    orderBy: [{ iata: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    take: Math.max(0, limit - exact.length),
  });
  return [...exact, ...partial].map((a) => ({
    kind: "airport" as const,
    airportId: a.id,
    iata: a.iata,
    name: a.name,
    address: null,
    city: a.city,
    lat: a.lat,
    lon: a.lon,
    country: a.country,
    timezone: a.timezone,
  }));
}

/** Both ends of the user's own rentals whose name or address matches, one hit per distinct place. */
async function earlierHits(userId: string, q: string, limit: number): Promise<RentalStationHit[]> {
  const contains = { contains: q, mode: "insensitive" as const };
  const rows = await prisma.rentalBooking.findMany({
    where: {
      userId,
      OR: [
        { pickupStationName: contains },
        { pickupAddress: contains },
        { returnStationName: contains },
        { returnAddress: contains },
      ],
    },
    orderBy: [{ pickupTime: "desc" }, { id: "desc" }],
    take: 200,
  });
  const seen = new Map<string, RentalStationHit>();
  const needle = q.toLowerCase();
  for (const r of rows) {
    for (const end of ["pickup", "return"] as const) {
      const name = end === "pickup" ? r.pickupStationName : r.returnStationName;
      const address = end === "pickup" ? r.pickupAddress : r.returnAddress;
      if (!`${name} ${address ?? ""}`.toLowerCase().includes(needle)) continue;
      const hit: RentalStationHit = {
        kind: "earlier",
        airportId: end === "pickup" ? r.pickupAirportId : r.returnAirportId,
        iata: null,
        name,
        address,
        city: null,
        lat: end === "pickup" ? r.pickupLat : r.returnLat,
        lon: end === "pickup" ? r.pickupLon : r.returnLon,
        country: end === "pickup" ? r.pickupCountry : r.returnCountry,
        timezone: end === "pickup" ? r.pickupTimezone : r.returnTimezone,
      };
      const key = `${name.toLowerCase()}|${hit.lat.toFixed(4)}|${hit.lon.toFixed(4)}`;
      if (!seen.has(key)) seen.set(key, hit);
    }
  }
  return [...seen.values()].slice(0, limit);
}

router.get(
  "/",
  rentalStationSearchLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) throw new AppError("Not authenticated", 401);
      const parsed = rentalStationSearchSchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400, "RENTAL_INVALID_QUERY");
      const { q, limit } = parsed.data;
      const [earlier, airports] = await Promise.all([
        earlierHits(req.userId, q, limit),
        airportHits(q, limit),
      ]);
      res.json({ success: true, data: [...earlier, ...airports] });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
