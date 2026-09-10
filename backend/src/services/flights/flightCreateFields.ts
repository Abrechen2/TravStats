import { Prisma } from "@prisma/client";

import { extendedFlightCreateFields, type ExtendedFlightInput } from "./extendedFlightFields";

/**
 * The fields both create paths must write, in one place so they cannot drift.
 *
 * They already had. The single-flight POST wrote ten columns the batch import
 * did not, and the batch answered 201 while quietly storing nulls: seat class,
 * aircraft registration, Mode-S address, and the whole special-flight group
 * (type, event and pattern coordinates, event label, the JSON payload). A
 * flight imported as First Class carried a first-class CO2 figure against a
 * blank cabin, which is the same shape of bug the single path had fixed for
 * itself and the batch never learned about (audit finding AUD-022).
 *
 * Two paths that must agree are exactly what a shared module is for — and
 * `routes/flights.ts` is over the 800-line limit and frozen at its size, so it
 * could not have lived there anyway.
 *
 * NOT in here: anything the two paths legitimately compute differently — the
 * airport enrichment, the derived status, CO2, the route distance, the FX
 * snapshot. Those are each a decision, not a copy.
 */

export interface SharedFlightCreateInput extends ExtendedFlightInput {
  seatClass?: string | null;
  aircraftRegistration?: string | null;
  aircraftModeS?: string | null;
  specialType?: string | null;
  eventLat?: number | null;
  eventLon?: number | null;
  eventLabel?: string | null;
  patternLat?: number | null;
  patternLon?: number | null;
  specialData?: unknown;
}

export function sharedFlightCreateFields(data: SharedFlightCreateInput) {
  return {
    // Persist the cabin, do not merely price its CO2 from it.
    seatClass: data.seatClass,
    aircraftRegistration: data.aircraftRegistration,
    aircraftModeS: data.aircraftModeS,
    ...extendedFlightCreateFields(data),
    // Special flights (Sonder-Flüge) — a non-null `specialType` marks this
    // flight as a sub-type. See schemas/flight.ts for the union.
    specialType: data.specialType ?? null,
    eventLat: data.eventLat ?? null,
    eventLon: data.eventLon ?? null,
    eventLabel: data.eventLabel ?? null,
    patternLat: data.patternLat ?? null,
    patternLon: data.patternLon ?? null,
    specialData:
      data.specialData === null || data.specialData === undefined
        ? Prisma.JsonNull
        : (data.specialData as unknown as Prisma.InputJsonValue),
  };
}
