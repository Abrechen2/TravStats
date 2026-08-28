/**
 * Schemas and helpers shared across the per-domain path modules.
 *
 * Registering a schema here (rather than inline in a domain file) is what
 * puts it under `components.schemas` and lets several endpoints reference
 * the same definition instead of inlining duplicates.
 */

import { z } from "zod";

import { registry } from "../registry";
import { createFlightSchema, updateFlightSchema, airportSchema } from "../../../schemas/flight";
import {
  apiTokenScopeSchema,
  createApiTokenSchema,
  sanitizedApiTokenSchema,
  createdApiTokenSchema,
} from "../../../schemas/apiToken";



export const errorResponse = registry.register(
  "Error",
  z
    .object({
      error: z.string().openapi({ example: "Invalid input" }),
      details: z.array(z.string()).optional(),
    })
    .openapi("Error")
);

export const flightCreateInput = registry.register(
  "FlightCreateInput",
  createFlightSchema.openapi("FlightCreateInput")
);

export const flightUpdateInput = registry.register(
  "FlightUpdateInput",
  updateFlightSchema.openapi("FlightUpdateInput")
);

export const flightResponse = registry.register(
  "Flight",
  z
    .object({
      id: z.string().uuid(),
      userId: z.string().uuid(),
      airline: z.string().nullable(),
      operatingAirline: z.string().nullable(),
      flightNumber: z.string().nullable(),
      aircraft: z.string().nullable(),
      depIata: z.string().nullable(),
      depIcao: z.string().nullable(),
      depName: z.string().nullable(),
      depLat: z.number(),
      depLon: z.number(),
      arrIata: z.string().nullable(),
      arrIcao: z.string().nullable(),
      arrName: z.string().nullable(),
      arrLat: z.number(),
      arrLon: z.number(),
      departureTime: z.string().datetime().nullable(),
      arrivalTime: z.string().datetime().nullable(),
      status: z.string(),
      seatNumber: z.string().nullable(),
      seatClass: z.string().nullable(),
      gate: z.string().nullable(),
      terminal: z.string().nullable(),
      bookingReference: z.string().nullable(),
      ticketNumber: z.string().nullable(),
      price: z.number().nullable(),
      currency: z.string().nullable(),
      taxes: z.number().nullable(),
      fees: z.number().nullable(),
      category: z.string().nullable(),
      tags: z.array(z.string()),
      companions: z.array(z.string()),
      notes: z.string().nullable(),
      createdAt: z.string().datetime(),
    })
    .openapi("Flight")
);

export const airportResponse = registry.register(
  "Airport",
  z
    .object({
      id: z.number(),
      iata: z.string().nullable(),
      icao: z.string().nullable(),
      name: z.string(),
      city: z.string().nullable(),
      country: z.string().nullable(),
      lat: z.number(),
      lon: z.number(),
      timezone: z.string().nullable(),
      isClosed: z.boolean(),
    })
    .openapi("Airport")
);

export const tripResponse = registry.register(
  "Trip",
  z
    .object({
      id: z.string().uuid(),
      userId: z.string().uuid(),
      name: z.string().nullable(),
      description: z.string().nullable(),
      startDate: z.string().datetime().nullable(),
      endDate: z.string().datetime().nullable(),
      createdAt: z.string().datetime(),
    })
    .openapi("Trip")
);

void airportSchema; // exported for consumers; not registered as standalone

registry.register("ApiTokenScope", apiTokenScopeSchema.openapi("ApiTokenScope"));
registry.register("CreateApiTokenInput", createApiTokenSchema.openapi("CreateApiTokenInput"));
registry.register("ApiToken", sanitizedApiTokenSchema.openapi("ApiToken"));
registry.register("CreatedApiToken", createdApiTokenSchema.openapi("CreatedApiToken"));



export const errorContent = {
  "application/json": { schema: errorResponse },
};
