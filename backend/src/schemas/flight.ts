import { z } from 'zod';

export const airportSchema = z.object({
  icao: z.string().optional(),
  iata: z.string().optional(),
  name: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const createFlightSchema = z.object({
  airline: z.string().min(1),
  flightNumber: z.string().min(1),
  callsign: z.string().optional(),
  aircraft: z.string().optional(),
  departure: z.object({
    icao: z.string().optional(),
    iata: z.string().optional(),
    name: z.string().optional(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  arrival: z.object({
    icao: z.string().optional(),
    iata: z.string().optional(),
    name: z.string().optional(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  departureTime: z.string().datetime(),
  arrivalTime: z.string().datetime(),
  status: z.enum(['scheduled', 'flown', 'cancelled']).default('scheduled'),
  notes: z.string().optional(),
}).refine(
  data => new Date(data.departureTime) < new Date(data.arrivalTime),
  {
    message: 'Departure time must be before arrival time',
    path: ['arrivalTime'],
  }
);

export const updateFlightSchema = createFlightSchema.partial();

export const flightQuerySchema = z.object({
  airline: z.string().optional(),
  flightNumber: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  status: z.enum(['scheduled', 'flown', 'cancelled']).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export type CreateFlightInput = z.infer<typeof createFlightSchema>;
export type UpdateFlightInput = z.infer<typeof updateFlightSchema>;
export type FlightQueryInput = z.infer<typeof flightQuerySchema>;
