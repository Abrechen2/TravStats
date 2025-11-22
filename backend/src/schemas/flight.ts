import { z } from 'zod';

export const airportSchema = z.object({
  icao: z.string().nullable().optional(),
  iata: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const baseFlightSchema = z.object({
  airline: z.string().min(1).optional(),
  flightNumber: z.string().min(1).optional(),
  callsign: z.string().optional(),
  aircraft: z.string().optional(),
  departure: z.object({
    icao: z.string().nullable().optional(),
    iata: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  arrival: z.object({
    icao: z.string().nullable().optional(),
    iata: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  departureTime: z.string().datetime(),
  arrivalTime: z.string().datetime(),
  status: z.enum(['scheduled', 'flown', 'cancelled']).default('scheduled'),
  notes: z.string().optional(),
  price: z.number().min(0).optional(),
  currency: z.enum(['EUR', 'USD', 'GBP', 'CHF']).optional(),
  taxes: z.number().min(0).optional(),
  fees: z.number().min(0).optional(),
  category: z.enum(['business', 'private', 'vacation']).optional(),
  tags: z.array(z.string().max(40)).optional(),
  receiptUrl: z.string().url().optional(),
});

export const createFlightSchema = baseFlightSchema.refine(
  data => new Date(data.departureTime) < new Date(data.arrivalTime),
  {
    message: 'Departure time must be before arrival time',
    path: ['arrivalTime'],
  }
);

export const updateFlightSchema = baseFlightSchema.partial();

export const flightQuerySchema = z.object({
  airline: z.string().optional(),
  flightNumber: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  status: z.enum(['scheduled', 'flown', 'cancelled']).optional(),
  category: z.enum(['business', 'private', 'vacation']).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export type CreateFlightInput = z.infer<typeof createFlightSchema>;
export type UpdateFlightInput = z.infer<typeof updateFlightSchema>;
export type FlightQueryInput = z.infer<typeof flightQuerySchema>;
