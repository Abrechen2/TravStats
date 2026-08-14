import { z } from 'zod';
import { currencyField } from './lodging';

const CABIN_TYPES = ['inside', 'oceanview', 'balcony', 'suite'] as const;
const STATUSES = ['scheduled', 'flown', 'cancelled', 'historical'] as const;

// "" and null both mean "clear" on the wire; undefined means "don't change"
// on update. The old empty->undefined transform made clearing impossible:
// the edit modal's blanked field collapsed into "keep the old value".
const emptyToNull = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v));

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
    // Third stop state: an imported port whose name could not be matched to the
    // catalog. Carried as a name-only stop (no portId, not a sea day) so it is
    // never lost; the user resolves it later via the PortPicker.
    unresolvedPortName: z.string().trim().min(1).max(200).nullable().optional(),
  })
  // 3-state invariant: a stop is valid iff it is a sea day, OR references a
  // port, OR carries an unresolved port name — and never mixes those.
  .superRefine((s, ctx) => {
    const hasPort = s.portId !== null && s.portId !== undefined;
    const hasUnresolved = s.unresolvedPortName !== null && s.unresolvedPortName !== undefined;
    if (!s.isAtSea && !hasPort && !hasUnresolved) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A stop must be at sea, reference a port, or carry an unresolved port name',
        path: ['portId'],
      });
    }
    if (hasPort && hasUnresolved) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A stop cannot be both a matched port and an unresolved port',
        path: ['unresolvedPortName'],
      });
    }
    if (s.isAtSea && (hasPort || hasUnresolved)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A sea day cannot reference a port or an unresolved port name',
        path: ['isAtSea'],
      });
    }
  });

const baseCruiseSchema = z.object({
  shipId: z.number().int().positive().nullable().optional(),
  shipNameOverride: emptyToNull,
  cruiseLine: emptyToNull,
  // Official itinerary / route name from the booking confirmation
  // (e.g. "Kanaren mit Marokko"), distinct from the trip's user label.
  routeName: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .transform((v) => (v ? v : v === undefined ? undefined : null)),
  departurePortId: z.number().int().positive().nullable().optional(),
  arrivalPortId: z.number().int().positive().nullable().optional(),
  startDate: isoDateTime,
  endDate: isoDateTime,
  status: z.enum(STATUSES).default('scheduled'),
  cabinNumber: z.string().max(20).nullable().optional(),
  cabinType: z.enum(CABIN_TYPES).nullable().optional(),
  deck: z.number().int().min(1).max(30).nullable().optional(),
  bookingReference: z.string().max(40).nullable().optional(),
  price: z.number().min(0).nullable().optional(),
  currency: currencyField.optional(),
  // Plain-text notes. The frontend renders these as React text (auto-escaped),
  // so no HTML sanitization happens or is needed here. The previous
  // `.replace(/<[^>]*>/g, '')` transform was INCOMPLETE sanitization (trivially
  // bypassable, e.g. nested/unclosed tags) that gave false security confidence
  // without an HTML sink — removed rather than "improved". Bounded to guard
  // against unbounded storage, consistent with the other string fields.
  notes: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  companions: z.array(z.string().max(100)).max(50).optional(),
  tripId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
  // Optional user-selectable map color. `#` prefix is optional to accept
  // both raw hex and the format the color-picker's `<input type="color">`
  // emits. `null` clears back to the auto-derived per-cruise color.
  color: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
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
