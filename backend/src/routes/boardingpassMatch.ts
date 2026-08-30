import { Router, Response } from "express";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";

import { authenticate, AuthRequest } from "../middleware/auth";
import { boardingPassParseLimiter } from "../middleware/rateLimit";
import { prisma } from "../db";
import logger from "../utils/logger";
import { readBoardingPass } from "../services/boardingPassRead";
import { validateBoardingPassImageBase64 } from "../utils/fileValidation";
import { getCachedAirport } from "../services/airportCache";

const router = Router();

const proposeSchema = z
  .object({
    barcode: z.string().min(1).max(2000).optional(),
    imageBase64: z
      .string()
      .min(1)
      .max(20 * 1024 * 1024, "Image too large (max 20MB)")
      .optional(),
  })
  .refine((d) => Boolean(d.barcode) || Boolean(d.imageBase64), {
    message: "Either barcode or imageBase64 is required",
  });

interface AirportDto {
  iata: string | null;
  icao: string | null;
  name: string | null;
  lat: number;
  lon: number;
  timezone: string | null;
}

const normalize = (s: string): string => s.replace(/\s+/g, "").toUpperCase();

/**
 * POST /api/v1/boardingpass/propose
 *
 * Parses a boarding pass (decoded BCBP barcode string and/or an image) and
 * proposes what to do WITHOUT writing anything: the recognized, save-ready
 * flight, plus whether it would create a new flight or complete (merge into)
 * an existing one. The app shows this for a 1-tap confirm, then commits via the
 * standard POST /api/v1/flights (?merge=true) route.
 *
 * Open endpoint — no Pro gating. PAT bearer auth (read scope is enough; it does
 * not persist anything).
 */
router.post("/propose", authenticate, boardingPassParseLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { barcode, imageBase64 } = proposeSchema.parse(req.body);

    // --- 1+2. Barcode, then OCR for what it does not carry -----------------
    // Shared with /parse-boardingpass — see services/boardingPassRead. A
    // supplied barcode wins over re-reading one out of the image, which is what
    // the live scanner path relies on: it decodes from a camera frame and
    // sends no photograph at all.
    //
    // An image that fails validation still has its barcode read; only OCR is
    // skipped. A picture too poor to read text off can hold a perfectly good
    // error-corrected barcode.
    const validation =
      imageBase64 === undefined ? null : validateBoardingPassImageBase64(imageBase64);
    if (validation !== null && !validation.valid) {
      logger.warn(
        { reason: validation.reason },
        "[BoardingPassPropose] image rejected by validation, continuing with barcode only"
      );
    }
    const reading = await readBoardingPass({
      imageBase64,
      barcode,
      userId,
      allowOcr: validation === null ? false : validation.valid,
    });

    const { decoded, merged } = reading;
    const flightNumber = merged.flightNumber;
    const fromCode = merged.departureCode;
    const toCode = merged.arrivalCode;
    const date = merged.departureTime?.slice(0, 10);
    const seatNumber = merged.seat;
    const bookingClassLetter = merged.bookingClassLetter;
    const pnr = merged.pnr ?? merged.bookingReference;
    const airline = merged.airline;
    const passengerName = decoded?.passengerName;
    // The barcode never carries these four, so OCR is their only source.
    const gate = merged.gate;
    const terminal = merged.terminal;
    const boardingGroup = merged.boardingGroup;
    const aircraft = merged.aircraft;
    const ocrUsed = reading.sources.ocr;

    // --- 3. Resolve airports (IATA -> coords) so the result is save-ready ---
    const departure = await resolveAirport(fromCode);
    const arrival = await resolveAirport(toCode);

    // --- 4. Match against an existing flight (preview only) -----------------
    // Pass the departure timezone so the day-window is computed the same way
    // the create path stores `departureTime` (local midnight → UTC). Without
    // this, a flight from a UTC+ airport is stored on the previous UTC day and
    // the matcher misses it → false "create" → duplicate on re-scan.
    const match = await findExistingFlight(userId, flightNumber, date, pnr, departure?.timezone);
    let fillsFields: string[] = [];
    if (match) {
      if (seatNumber && !match.seatNumber) fillsFields.push("seatNumber");
      if (gate && !match.gate) fillsFields.push("gate");
      if (terminal && !match.terminal) fillsFields.push("terminal");
      if (pnr && !match.bookingReference) fillsFields.push("bookingReference");
      if (bookingClassLetter && !match.bookingClassLetter) fillsFields.push("bookingClassLetter");
    }

    const missing: string[] = [];
    if (!flightNumber) missing.push("flightNumber");
    if (!departure) missing.push("departure");
    if (!arrival) missing.push("arrival");
    if (!date) missing.push("date");

    res.json({
      recognized: {
        flightNumber: flightNumber ?? null,
        airline: airline ?? null,
        departure,
        arrival,
        date: date ?? null,
        seatNumber: seatNumber ?? null,
        bookingClassLetter: bookingClassLetter ?? null,
        pnr: pnr ?? null,
        gate: gate ?? null,
        terminal: terminal ?? null,
        boardingGroup: boardingGroup ?? null,
        aircraft: aircraft ?? null,
        passengerName: passengerName ?? null,
      },
      sources: { barcode: Boolean(decoded), ocr: ocrUsed },
      missing,
      action: match ? "merge" : "create",
      match: match
        ? {
            id: match.id,
            flightNumber: match.flightNumber,
            date: match.departureTime,
            route: `${match.depIata ?? "?"} → ${match.arrIata ?? "?"}`,
            fillsFields,
          }
        : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    logger.error({ error }, "[BoardingPassPropose] failed");
    res.status(500).json({
      error: "Boarding pass proposal failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

async function resolveAirport(code: string | undefined): Promise<AirportDto | null> {
  if (!code) return null;
  const a = await getCachedAirport(code);
  if (!a) return null;
  return {
    iata: a.iata ?? null,
    icao: a.icao ?? null,
    name: a.name ?? null,
    lat: a.lat,
    lon: a.lon,
    timezone: a.timezone ?? null,
  };
}

interface FlightMatch {
  id: string;
  flightNumber: string | null;
  departureTime: Date | null;
  depIata: string | null;
  arrIata: string | null;
  seatNumber: string | null;
  gate: string | null;
  terminal: string | null;
  bookingReference: string | null;
  bookingClassLetter: string | null;
}

const MATCH_SELECT = {
  id: true,
  flightNumber: true,
  departureTime: true,
  depIata: true,
  arrIata: true,
  seatNumber: true,
  gate: true,
  terminal: true,
  bookingReference: true,
  bookingClassLetter: true,
} as const;

/**
 * Same match key the /flights create path uses (normalized flight number +
 * same UTC calendar day), so the preview agrees with what ?merge=true will do.
 * PNR is a stronger key, so try it first when present.
 *
 * The day-window MUST be derived the same way the create path stores
 * `departureTime`: local midnight in the departure airport's timezone, then
 * converted to UTC (see flights.ts `toUtcDate` + its dedup window). Building
 * the window from the bare date as UTC midnight instead would, for a UTC+
 * airport, miss the stored flight (which sits on the previous UTC day) and
 * wrongly propose "create" — re-scanning the same pass then duplicates it.
 */
export async function findExistingFlight(
  userId: string,
  flightNumber: string | undefined,
  date: string | undefined,
  pnr: string | undefined,
  depTimezone: string | null | undefined
): Promise<FlightMatch | null> {
  if (pnr) {
    const byPnr = await prisma.flight.findFirst({
      where: { userId, bookingReference: pnr },
      select: MATCH_SELECT,
    });
    if (byPnr) return byPnr;
  }

  if (flightNumber && date) {
    const departureUtc = depTimezone
      ? fromZonedTime(`${date}T00:00`, depTimezone)
      : new Date(`${date}T00:00:00.000Z`);
    if (!Number.isNaN(departureUtc.getTime())) {
      const dayStart = new Date(departureUtc);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const candidates = await prisma.flight.findMany({
        where: { userId, departureTime: { gte: dayStart, lt: dayEnd } },
        select: MATCH_SELECT,
      });
      const target = normalize(flightNumber);
      return candidates.find((c) => c.flightNumber && normalize(c.flightNumber) === target) ?? null;
    }
  }

  return null;
}

export default router;
