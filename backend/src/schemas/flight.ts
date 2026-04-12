import { z } from 'zod';

// Whitelist of allowed receipt URL domains (common cloud storage and document services)
const ALLOWED_RECEIPT_DOMAINS = [
  'dropbox.com',
  'drive.google.com',
  'docs.google.com',
  'onedrive.live.com',
  '1drv.ms',
  'box.com',
  'icloud.com',
  's3.amazonaws.com',
  'cloudinary.com',
  'imgur.com',
  // Add your own domain here if you host receipts
];

/**
 * Custom receipt URL validator
 * Ensures the URL is from a trusted domain or is a local upload
 */
const receiptUrlValidator = z
  .string()
  .refine(
    (url) => {
      // Allow local uploads (starts with /api/v1/uploads/)
      if (url.startsWith('/api/v1/uploads/')) {
        return true;
      }

      // For external URLs, validate domain
      try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname.toLowerCase();
        // Check if hostname ends with any allowed domain
        return ALLOWED_RECEIPT_DOMAINS.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
        );
      } catch {
        return false;
      }
    },
    {
      message: `Receipt URL must be a local upload (/api/v1/uploads/) or from a trusted domain: ${ALLOWED_RECEIPT_DOMAINS.join(', ')}`,
    }
  )
  .optional();

export const airportSchema = z.object({
  icao: z.string().nullable().optional(),
  iata: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const emptyStringToUndefined = z.string().optional().transform((v) => (v === "" ? undefined : v));

const baseFlightSchema = z.object({
  airline: emptyStringToUndefined,
  operatingAirline: emptyStringToUndefined,
  flightNumber: emptyStringToUndefined,
  callsign: z.string().nullable().optional(),
  aircraft: z.string().nullable().optional(),
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
  departureTime: z.string().datetime().optional().nullable(),
  arrivalTime: z.string().datetime().optional().nullable(),
  actualDeparture: z.string().datetime().optional().nullable(),
  actualArrival:   z.string().datetime().optional().nullable(),
  status: z.enum(['scheduled', 'flown', 'cancelled', 'historical']).default('scheduled'),
  notes: z.string().transform((v) => v.replace(/<[^>]*>/g, '')).optional(),
  price: z.number().min(0).optional(),
  currency: z.enum(['EUR', 'USD', 'GBP', 'CHF']).optional(),
  taxes: z.number().min(0).optional(),
  fees: z.number().min(0).optional(),
  category: z.enum(['business', 'private', 'vacation']).optional(),
  seatClass: z.enum(['economy', 'premium_economy', 'business', 'first']).nullable().optional(),
  tags: z.array(z.string().max(40)).optional(),
  companions: z.array(z.string().max(100)).max(50).optional().default([]),
  receiptUrl: receiptUrlValidator,
  // Boarding pass / email import fields
  seatNumber: z.string().max(10).optional(),
  boardingGroup: z.string().max(20).optional(),
  gate: z.string().max(20).optional(),
  terminal: z.string().max(20).optional(),
  bookingReference: z.string().max(20).optional(),
  ticketNumber: z.string().max(30).optional(),
  baggageAllowance: z.string().max(50).optional(),
  frequentFlyerNumber: z.string().max(30).optional(),
  bookingClassLetter: z.string().max(5).optional(),
  coPassengers: z.array(z.string().max(100)).max(50).optional(),
});

export const createFlightSchema = baseFlightSchema.refine(
  data => {
    if (data.status === 'historical') return true;
    if (!data.departureTime || !data.arrivalTime) return false;
    const depTime = new Date(data.departureTime);
    const arrTime = new Date(data.arrivalTime);
    const diffHours = (arrTime.getTime() - depTime.getTime()) / (1000 * 60 * 60);
    return diffHours >= -12 && diffHours <= 24;
  },
  {
    message: 'Non-historical flights require departure and arrival times with valid duration',
    path: ['arrivalTime'],
  }
);

export const updateFlightSchema = baseFlightSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  {
    message: 'At least one field must be provided for update',
  }
);

export const flightQuerySchema = z.object({
  airline: z.union([z.string(), z.array(z.string())]).optional(),
  flightNumber: z.string().optional(),
  departureAirport: z.string().optional(),
  arrivalAirport: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  status: z.union([z.enum(['scheduled', 'flown', 'cancelled', 'historical']), z.array(z.enum(['scheduled', 'flown', 'cancelled', 'historical']))]).optional(),
  category: z.enum(['business', 'private', 'vacation']).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minRouteCount: z.coerce.number().min(1).max(100).optional(), // frontend-only; ignored server-side
  limit: z.coerce.number().min(1).default(100),
  offset: z.coerce.number().min(0).default(0),
});

export type CreateFlightInput = z.infer<typeof createFlightSchema>;
export type UpdateFlightInput = z.infer<typeof updateFlightSchema>;
export type FlightQueryInput = z.infer<typeof flightQuerySchema>;
