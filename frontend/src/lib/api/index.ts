export * from "./types";
export * from "./client";
export { default } from "./client";
export * from "./auth";
export * from "./parse";
export * from "./flights";
export * from "./stats";
export * from "./airports";
export * from "./achievements";
export * from "./settings";
export * from "./analytics";
export * from "./training";
export * from "./uploads";
export * from "./setup";
export * from "./admin";
export * from "./notifications";
export * from "./pendingUpdates";
export * from "./backup";
export * from "./template";
export * from "./suggestions";
export * from "./diagnosticExport";
export * from "./cruise";
export * from "./catalogue";
export * from "./version";
export * from "./immich";
export * from "./usageStats";
export * from "./companions";
export * from "./twoFactor";
export * from "./passkeys";
// Named export (not `export *`) to avoid re-exporting Trip/Booking,
// which are already exported from ../../types/index.ts
export { tripsApi } from "./trips";
export type {
  CreateTripInput,
  UpdateTripInput,
  AssignFlightsInput,
  CreateBookingInput,
} from "./trips";
// UpdateBookingInput lives in ../../types (see the note above re: Booking).
