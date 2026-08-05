import { z } from 'zod';

/**
 * Manual airport creation (#191) — the flight-side mirror of
 * createShipSchema/createPortSchema in cruiseData.ts. Used by the admin
 * master-data page for airfields the OurAirports CSV does not carry
 * (or carries without the code users know it by).
 *
 * Codes are optional BOTH: a private airfield legitimately has neither an
 * IATA nor an ICAO code — name + coordinates are enough for the
 * autocomplete's name search and for distance/CO2 math. The timezone is
 * derived server-side from the coordinates via geo-tz, never supplied by
 * the client.
 */
export const createAirportSchema = z.object({
  name: z.string().trim().min(1).max(120),
  iata: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3}$/, 'IATA code must be exactly 3 letters/digits')
    .optional(),
  icao: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4}$/, 'ICAO code must be exactly 4 letters/digits')
    .optional(),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  altitude: z.number().int().min(-500).max(10000).optional(),
});

export type CreateAirportInput = z.infer<typeof createAirportSchema>;
