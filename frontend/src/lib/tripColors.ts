/**
 * Trip color palette — keep in sync with backend/src/schemas/trip.ts TRIP_COLORS.
 * These colors are used for auto-assignment on trip creation and in the color picker.
 */
export const TRIP_COLORS = [
  "#818cf8",
  "#38bdf8",
  "#34d399",
  "#fb923c",
  "#f472b6",
  "#a78bfa",
  "#22d3ee",
  "#86efac",
  "#fbbf24",
  "#f87171",
] as const;

export type TripColor = (typeof TRIP_COLORS)[number];
