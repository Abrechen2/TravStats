import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { prisma } from "../db";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { statsLimiter } from "../middleware/rateLimit";
import {
  geoContentType,
  geoFileName,
  geoFormatQuerySchema,
  geoFoot,
  geoHead,
  geoLine,
  geoWaypoint,
  hasGeometry,
  splitSegments,
  type GeoFormat,
  type GeoLine,
} from "../services/geoExport/geoFile";
import { viewableFlightTrack } from "../services/travtrack/flightTrackView";

/**
 * GPX / KML downloads (forgejo#402): a recorded flight track, a cruise's
 * recorded tracks, a rail / bus / ferry ride's stored line, and places as
 * waypoints. `?format=gpx` (default) or `kml`.
 *
 * Mounted on `/api/v1` before the routers whose `/:id` would answer
 * `/places/export` as a place — so middleware is PER ROUTE, as in
 * `tripPhotoWindows.ts`. Every lookup filters on `userId`: another user's
 * record answers exactly like a missing one. A record with nothing to write
 * is `422 GEO_EXPORT_EMPTY`, never an empty file that looks like success.
 *
 * TravPlan stages are NOT exported: a plan stores routed distance and
 * duration only, no line (`stage_metrics`), so there is nothing to write.
 */
const router = Router();
const idParams = z.object({ id: z.string().uuid() });
const placesQuery = geoFormatQuerySchema.extend({ listId: z.string().uuid().optional() });

const empty = (what: string) =>
  new AppError(`${what} has no line to export`, 422, "GEO_EXPORT_EMPTY");

function send(res: Response, format: GeoFormat, fileName: string, body: string): void {
  res.setHeader("Content-Type", geoContentType(format));
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(body);
}

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle =
  (fn: Handler) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

const parseId = (req: AuthRequest): string => {
  const parsed = idParams.safeParse(req.params);
  if (!parsed.success) throw new AppError("Invalid id", 400);
  return parsed.data.id;
};

router.get(
  "/flights/:id/track/export",
  authenticate,
  statsLimiter,
  handle(async (req, res) => {
    const userId = req.userId!;
    const format = geoFormatQuerySchema.parse(req.query).format;
    const flight = await prisma.flight.findFirst({
      where: { id: parseId(req), userId },
      select: { id: true, flightNumber: true, departureTime: true },
    });
    if (!flight) throw new AppError("Flight not found", 404, "FLIGHT_NOT_FOUND");
    const stored = await prisma.flightTrack.findUnique({
      where: { flightId: flight.id },
      select: { geometry: true, segmentStarts: true, startedAt: true, endedAt: true },
    });
    // The same privacy cut every other reader of a recording goes through.
    const shown = stored ? (await viewableFlightTrack(userId, stored)).track : null;
    const segments = shown ? splitSegments(shown.geometry, shown.segmentStarts) : [];
    if (!stored || !hasGeometry(segments)) throw empty("The flight");
    const name = flight.flightNumber ? `Flight ${flight.flightNumber}` : "Flight";
    const body = geoHead(format, name) + geoLine(format, { name, segments }) + geoFoot(format);
    send(res, format, geoFileName(name, format, flight.departureTime ?? stored.startedAt), body);
  })
);

router.get(
  "/cruises/:id/tracks/export",
  authenticate,
  statsLimiter,
  handle(async (req, res) => {
    const userId = req.userId!;
    const format = geoFormatQuerySchema.parse(req.query).format;
    const cruise = await prisma.cruise.findFirst({
      where: { id: parseId(req), userId },
      select: { id: true, routeName: true, shipNameOverride: true },
    });
    if (!cruise) throw new AppError("Cruise not found", 404);
    const tracks = await prisma.cruiseTrack.findMany({
      where: { cruiseId: cruise.id },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      select: { name: true, startedAt: true, geometry: true, segmentStarts: true },
    });
    const name = cruise.routeName ?? cruise.shipNameOverride ?? "Cruise";
    const lines: GeoLine[] = tracks.map((t, i) => ({
      name: t.name ?? `${name} ${i + 1}`,
      segments: splitSegments(t.geometry, t.segmentStarts),
    }));
    if (!lines.some((l) => hasGeometry(l.segments))) throw empty("The cruise");
    const body =
      geoHead(format, name) + lines.map((l) => geoLine(format, l)).join("") + geoFoot(format);
    send(res, format, geoFileName(name, format, tracks[0]!.startedAt), body);
  })
);

/** The three ride tables share the columns this reads; only the Prisma delegate differs. */
type RideRow = {
  depStationName: string;
  arrStationName: string;
  departureTime: Date;
  geometry: unknown;
};
type RideFinder = (id: string, userId: string) => Promise<RideRow | null>;

function rideRoute(path: string, label: string, find: RideFinder) {
  router.get(
    path,
    authenticate,
    statsLimiter,
    handle(async (req, res) => {
      const format = geoFormatQuerySchema.parse(req.query).format;
      const ride = await find(parseId(req), req.userId!);
      if (!ride) throw new AppError(`${label} not found`, 404);
      const segments = splitSegments(ride.geometry, [0]);
      if (!hasGeometry(segments)) throw empty(`The ${label.toLowerCase()}`);
      const name = `${ride.depStationName} - ${ride.arrStationName}`;
      const body = geoHead(format, name) + geoLine(format, { name, segments }) + geoFoot(format);
      send(res, format, geoFileName(name, format, ride.departureTime), body);
    })
  );
}

const rideSelect = {
  depStationName: true,
  arrStationName: true,
  departureTime: true,
  geometry: true,
} as const;
rideRoute("/rail/:id/line/export", "Rail journey", (id, userId) =>
  prisma.railJourney.findFirst({ where: { id, userId }, select: rideSelect })
);
rideRoute("/bus/:id/line/export", "Bus journey", (id, userId) =>
  prisma.busJourney.findFirst({ where: { id, userId }, select: rideSelect })
);
rideRoute("/ferry/:id/line/export", "Ferry journey", (id, userId) =>
  prisma.ferryJourney.findFirst({ where: { id, userId }, select: rideSelect })
);

const PLACE_PAGE = 1000;

router.get(
  "/places/export",
  authenticate,
  statsLimiter,
  handle(async (req, res) => {
    const userId = req.userId!;
    const { format, listId } = placesQuery.parse(req.query);
    let listName: string | null = null;
    if (listId) {
      const list = await prisma.placeList.findFirst({
        where: { id: listId, userId },
        select: { name: true },
      });
      if (!list) throw new AppError("Place list not found", 404);
      listName = list.name;
    }
    const where = { userId, ...(listId ? { listEntries: { some: { listId } } } : {}) };
    const name = listName ?? "Places";
    // Streamed in id-ordered pages: the response never holds the whole account.
    let cursor: string | undefined;
    let written = 0;
    for (;;) {
      const page = await prisma.place.findMany({
        where,
        orderBy: { id: "asc" },
        take: PLACE_PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          name: true,
          localName: true,
          category: true,
          lat: true,
          lon: true,
          address: true,
          city: true,
          country: true,
        },
      });
      if (page.length === 0) break;
      if (written === 0) {
        res.setHeader("Content-Type", geoContentType(format));
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${geoFileName(name, format, new Date())}"`
        );
        res.write(geoHead(format, name));
      }
      for (const p of page) {
        const location = [p.address, p.city, p.country].filter(Boolean).join(", ");
        res.write(
          geoWaypoint(format, {
            name: p.localName ? `${p.name} (${p.localName})` : p.name,
            lat: p.lat,
            lon: p.lon,
            desc: location || null,
            type: p.category,
          })
        );
      }
      written += page.length;
      cursor = page[page.length - 1]!.id;
      if (page.length < PLACE_PAGE) break;
    }
    if (written === 0) throw new AppError("There are no places to export", 422, "GEO_EXPORT_EMPTY");
    res.end(geoFoot(format));
  })
);

export default router;
