import { z } from "zod";
import type { PlanState } from "./types";
const id = z.string().uuid();
const text = (n = 300) => z.string().trim().max(n);
export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v;
  });
const day = daySchema.nullable();
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();
const zone = text(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  })
  .nullable();
const money = z.number().finite().min(0).max(1e9);
const currency = z.string().regex(/^[A-Z]{3}$/);
export const kindSchema = z.enum([
  "activity",
  "flight",
  "hotel",
  "rail",
  "bus",
  "ferry",
  "cruise",
  "rental",
  "transfer",
  "free",
]);
export const itemSchema = z
  .object({
    id,
    title: text(200).min(1),
    kind: kindSchema,
    day,
    time,
    duration: z.number().int().min(0).max(1440).nullable(),
    timezone: zone,
    place: text(200),
    note: text(1000),
    booked: z.boolean(),
    bookingId: id.nullable(),
    execution: z.enum(["unconfirmed", "confirmed", "skipped", "cancelled"]),
    source: z.object({ kind: text(40), id, version:text(100).optional(),bookingVersion:text(100).optional(),auxId:id.optional(),auxVersion:text(100).optional(),createdAux:z.boolean().optional() }).nullable(),
  })
  .strict();
export const ideaSchema = z
  .object({
    id,
    title: text(200).min(1),
    category: text(40),
    priority: z.enum(["must", "optional", "maybe"]),
    note: text(1000),
    itemId: id.nullable(),
  })
  .strict();
export const bookingSchema = z
  .object({
    id,
    actualBookingId:id.nullable().optional().default(null),
    kind: kindSchema,
    title: text(200).min(1),
    reference: text(100).nullable(),
    provider: text(200),
    day,
    endDay: day,
    time,
    timezone: zone,
    arrivalDay: day.optional().default(null),
    arrivalTime: time.optional().default(null),
    arrivalTimezone: zone.optional().default(null),
    originPlace: text(200).optional().default(""),
    overnight: z.boolean().optional().default(false),
    amount: money.nullable(),
    paid: money,
    currency,
    place: text(200),
    documentIds: z.array(id).max(10),
    source: text(200),
    details: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine((v) => v.amount === null || v.paid <= v.amount, { message: "Paid amount exceeds total" })
  .refine((v) => !v.day || !v.endDay || v.endDay >= v.day, { message: "End precedes start" });
export const transferSchema = z
  .object({
    id,
    fromId: id,
    toId: id,
    status: z.enum(["open", "organized", "conscious"]),
    mode: text(100),
    note: text(1000),
    duration: z.number().int().min(0).max(1440).nullable(),
    buffer: z.number().int().min(0).max(720),
    fingerprint: text(2000).nullable(),
  })
  .strict();
export const packingSchema = z
  .object({
    id,
    label: text(120).min(1),
    category: text(40),
    quantity: z.number().int().min(1).max(100),
    packed: z.boolean(),
    scope: z.enum(["personal", "shared"]),
    note: text(1000),
    manual: z.boolean(),
  })
  .strict();
export const taskSchema = z
  .object({ id, title: text(200).min(1), due: day, done: z.boolean() })
  .strict();
export const costSchema = z
  .object({
    id,
    title: text(200).min(1),
    amount: money.nullable(),
    currency,
    paid: money,
    kind: z.enum(["estimate", "booked"]),
  })
  .strict()
  .refine((v) => v.amount === null || v.paid <= v.amount);
export const decisionSchema = z
  .object({
    id: text(200).min(1),
    fingerprint: text(2000),
    choice: z.enum(["conscious", "dismissed"]),
    decidedAt: z.string().datetime(),
  })
  .strict();
export const forecastSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: text(100),
  source: z.string().url(),
  fetchedAt: z.string().datetime(),
  days: z
    .array(
      z.object({
        day: daySchema,
        min: z.number().nullable(),
        max: z.number().nullable(),
        rainProbability: z.number().min(0).max(100).nullable(),
        wind: z.number().min(0).nullable(),
      })
    )
    .max(16),
});
export const settingsSchema = z
  .object({
    destination: text(200),
    startDay: day,
    endDay: day,
    timezone: zone,
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    travelers: z.number().int().min(1).max(100),
    pace: z.enum(["relaxed", "balanced", "busy"]),
    budget: money.nullable(),
    currency,
    freeDays: z.array(daySchema).max(366),
    openNights: z.array(daySchema).max(366),
    ai: z.object({ enabled: z.boolean(), policy: z.enum(["local_only", "cloud_allowed"]) }),
    packingProfile: z.object({
      washing: z.enum(["unknown", "yes", "no"]),
      luggage: z.enum(["unknown", "cabin", "checked"]),
    }),
  })
  .strict();
export const stateSchema = settingsSchema
  .extend({
    version: z.literal(1),
    status: z.enum(["planning", "ready", "archived"]),
    handoverRevision: z.number().int().nullable(),
    items: z.array(itemSchema).max(500),
    ideas: z.array(ideaSchema).max(200),
    bookings: z.array(bookingSchema).max(200),
    transfers: z.array(transferSchema).max(200),
    packing: z.array(packingSchema).max(200),
    tasks: z.array(taskSchema).max(200),
    costs: z.array(costSchema).max(200),
    decisions: z.array(decisionSchema).max(500),
    forecast: forecastSchema.nullable(),
  })
  .refine((v) => !v.startDay || !v.endDay || v.startDay <= v.endDay, {
    message: "End precedes start",
  })
  .refine(
    (v) => !v.startDay || !v.endDay || Date.parse(v.endDay) - Date.parse(v.startDay) <= 366 * 864e5,
    { message: "Plan exceeds one year" }
  );
export const collectionSchemas = {
  items: itemSchema,
  ideas: ideaSchema,
  bookings: bookingSchema,
  transfers: transferSchema,
  packing: packingSchema,
  tasks: taskSchema,
  costs: costSchema,
};
const operationSchema = z.discriminatedUnion("type", [
 z.object({type:z.literal("link_actual"),id,sourceId:id}).strict(),
  z
    .object({
      type: z.literal("settings"),
      values: settingsSchema.partial(),
      name: text(200).min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("upsert"),
      collection: z.enum(["items", "ideas", "bookings", "transfers", "packing", "tasks", "costs"]),
      value: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("remove"),
      collection: z.enum(["items", "ideas", "bookings", "transfers", "packing", "tasks", "costs"]),
      id,
    })
    .strict(),
  z.object({ type: z.literal("decision"), value: decisionSchema }).strict(),
  z
    .object({
      type: z.literal("assign_idea"),
      ideaId: id,
      day,
      time,
      duration: z.number().int().min(0).max(1440).nullable(),
    })
    .strict(),
  z.object({ type: z.literal("handover") }).strict(),
  z.object({ type: z.literal("execution"), id, execution: itemSchema.shape.execution }).strict(),
  z.object({ type: z.literal("undo"), mutationId: id }).strict(),
  z.object({ type: z.literal("proposal"), proposalId: id }).strict(),
]);
export const writeSchema = z
  .object({ clientRef: id, baseRevision: z.number().int().min(1), operation: operationSchema })
  .strict();
export const createPlanSchema = z
  .object({
    name: text(200).min(1),
    tripId: id.optional(),
    clientRef: id,
    settings: settingsSchema.partial().default({}),
  })
  .strict();
export const proposalContentSchema = z
  .object({
    summary: text(1000).min(1),
    assumptions: z.array(text(300)).max(10),
    changes: z
      .array(z.object({ id, day, time, reason: text(300) }).strict())
      .min(1)
      .max(20),
  })
  .strict();
export function emptyState(): PlanState {
  return {
    version: 1,
    destination: "",
    startDay: null,
    endDay: null,
    timezone: null,
    latitude: null,
    longitude: null,
    travelers: 1,
    pace: "balanced",
    budget: null,
    currency: "EUR",
    freeDays: [],
    openNights: [],
    status: "planning",
    handoverRevision: null,
    ai: { enabled: false, policy: "local_only" },
    packingProfile: { washing: "unknown", luggage: "unknown" },
    items: [],
    ideas: [],
    bookings: [],
    transfers: [],
    packing: [],
    tasks: [],
    costs: [],
    decisions: [],
    forecast: null,
  };
}
