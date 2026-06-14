import { z } from 'zod';

const CABIN_TYPES = ['inside', 'oceanview', 'balcony', 'suite'] as const;
const STATUSES = ['scheduled', 'flown', 'cancelled', 'historical'] as const;
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const;

const emptyToUndefined = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

// Accept partial datetimes and coerce them to full ISO 8601. The cruise
// booking parser emits times like "2026-06-17T08:00" (no seconds/offset),
// which a strict `z.string().datetime()` rejects — and unedited stops in the
// import preview keep that raw value. Coerce any parseable string to a full
// ISO string; genuinely invalid strings fall through to the strict check.
const isoDateTime = z.preprocess(
  (v) => {
    if (typeof v !== 'string' || v === '') return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  },
  z.string().datetime().nullable().optional(),
);

const stopSchema = z
  .object({
    portId: z.number().int().positive().nullable().optional(),
    dayNumber: z.number().int().min(1).max(365),
    // Calendar date of the stop. Booking confirmations list a date per stop
    // (often without clock times), so this captures it even when arrival/
    // departure times are absent. Coerced to a full ISO instant via isoDateTime
    // ("2027-10-08" -> "2027-10-08T00:00:00.000Z").
    date: isoDateTime,
    isAtSea: z.boolean().default(false),
    arrivalTime: isoDateTime,
    departureTime: isoDateTime,
    excursionNote: z.string().max(500).optional(),
  })
  .refine((s) => s.isAtSea || (s.portId !== null && s.portId !== undefined), {
    message: 'A stop must either be at sea or reference a port',
    path: ['portId'],
  });

const baseCruiseSchema = z.object({
  shipId: z.number().int().positive().nullable().optional(),
  shipNameOverride: emptyToUndefined,
  cruiseLine: emptyToUndefined,
  // Official itinerary / route name from the booking confirmation
  // (e.g. "Kanaren mit Marokko"), distinct from the trip's user label.
  routeName: z
    .string()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
  departurePortId: z.number().int().positive().nullable().optional(),
  arrivalPortId: z.number().int().positive().nullable().optional(),
  startDate: isoDateTime,
  endDate: isoDateTime,
  status: z.enum(STATUSES).default('scheduled'),
  cabinNumber: z.string().max(20).optional(),
  cabinType: z.enum(CABIN_TYPES).optional(),
  deck: z.number().int().min(1).max(30).optional(),
  bookingReference: z.string().max(40).optional(),
  price: z.number().min(0).optional(),
  currency: z.enum(CURRENCIES).optional(),
  notes: z
    .string()
    .transform((v) => v.replace(/<[^>]*>/g, ''))
    .optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  companions: z.array(z.string().max(100)).max(50).optional(),
  tripId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
  stops: z.array(stopSchema).max(60).optional(),
});

export const createCruiseSchema = baseCruiseSchema.refine(
  (data) => {
    if (!data.startDate || !data.endDate) return true;
    return new Date(data.endDate).getTime() >= new Date(data.startDate).getTime();
  },
  { message: 'endDate must not precede startDate', path: ['endDate'] },
);

export const updateCruiseSchema = baseCruiseSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const cruiseQuerySchema = z.object({
  status: z.union([z.enum(STATUSES), z.array(z.enum(STATUSES))]).optional(),
  cruiseLine: z.union([z.string(), z.array(z.string())]).optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  region: z.string().optional(),
  tripId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['date', 'ship', 'line', 'ports', 'status']).optional(),
});

export type CruiseInput = z.infer<typeof baseCruiseSchema>;
export type CruiseQueryInput = z.infer<typeof cruiseQuerySchema>;
