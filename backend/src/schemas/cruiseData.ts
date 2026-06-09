import { z } from "zod";

/**
 * Parser-output schema for cruise bookings. Mirrors the shape of FlightData
 * conceptually — fields are optional because the LLM/regex may extract only
 * a subset reliably. Strict Cruise create/update validation lives in
 * ../schemas/cruise.ts; this schema is the intermediate parser-output shape.
 */

export const cruiseStopParsedSchema = z.object({
  portName: z.string().optional(),
  portCountry: z.string().optional(),
  dayNumber: z.number().int().min(1).optional(),
  arrivalTime: z.string().optional(),
  departureTime: z.string().optional(),
  isAtSea: z.boolean().optional(),
});

export const cruiseDataSchema = z.object({
  shipName: z.string().optional(),
  cruiseLine: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  departurePortName: z.string().optional(),
  arrivalPortName: z.string().optional(),
  cabinNumber: z.string().optional(),
  cabinType: z.enum(["inside", "oceanview", "balcony", "suite"]).optional(),
  deck: z.number().int().optional(),
  bookingReference: z.string().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),
  stops: z.array(cruiseStopParsedSchema).optional(),
});

export type CruiseData = z.infer<typeof cruiseDataSchema>;
export type CruiseStopParsed = z.infer<typeof cruiseStopParsedSchema>;
