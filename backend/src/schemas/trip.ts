import { z } from "zod";

export const TRIP_COLORS = [
  "#818cf8", "#38bdf8", "#34d399", "#fb923c", "#f472b6",
  "#a78bfa", "#22d3ee", "#86efac", "#fbbf24", "#f87171",
];

export const createTripSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const updateTripSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const assignFlightsSchema = z.object({
  flightIds: z.array(z.string().uuid()).min(1),
  action: z.enum(["add", "remove"]),
});

export const createBookingSchema = z.object({
  tripId: z.string().uuid().optional(),
  pnr: z.string().max(20).optional(),
  price: z.number().min(0).optional(),
  currency: z.enum(["EUR", "USD", "GBP", "CHF"]).optional(),
  flightIds: z.array(z.string().uuid()).optional(),
});

export type CreateTripInput = z.infer<typeof createTripSchema>;
export type UpdateTripInput = z.infer<typeof updateTripSchema>;
export type AssignFlightsInput = z.infer<typeof assignFlightsSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
