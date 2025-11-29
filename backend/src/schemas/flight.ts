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
  receiptUrl: receiptUrlValidator,
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
  departureAirport: z.string().optional(),
  arrivalAirport: z.string().optional(),
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
