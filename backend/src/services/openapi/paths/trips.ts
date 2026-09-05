/**
 * Trip endpoints.
 *
 * A trip is the container everything else can point at: flights, cruises,
 * lodging stays and place visits all carry an optional `tripId`. What lives ON
 * the trip is only what belongs to no single domain — its own stops, its diary,
 * its photos, and the bookings that paid for several things at once.
 *
 * Two families here are not CRUD, and are documented as such: `detect` proposes
 * trips from flights the user already has, and `cleanup` finds trips too small
 * to be worth keeping. Both only report; neither writes without a second call.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent, tripResponse } from "./shared";
import {
  createTripSchema,
  updateTripSchema,
  assignFlightsSchema,
  createBookingSchema,
  updateBookingSchema,
  createStopSchema,
  updateStopSchema,
  createJournalSchema,
  updateJournalSchema,
} from "../../../schemas/trip";

const tripCreateInput = registry.register(
  "TripCreateInput",
  createTripSchema.openapi("TripCreateInput")
);
const tripUpdateInput = registry.register(
  "TripUpdateInput",
  updateTripSchema.openapi("TripUpdateInput")
);
const stopCreateInput = registry.register(
  "TripStopCreateInput",
  createStopSchema.openapi("TripStopCreateInput")
);
const stopUpdateInput = registry.register(
  "TripStopUpdateInput",
  updateStopSchema.openapi("TripStopUpdateInput")
);
const journalCreateInput = registry.register(
  "TripJournalCreateInput",
  createJournalSchema.openapi("TripJournalCreateInput")
);
const journalUpdateInput = registry.register(
  "TripJournalUpdateInput",
  updateJournalSchema.openapi("TripJournalUpdateInput")
);
const bookingCreateInput = registry.register(
  "BookingCreateInput",
  createBookingSchema.openapi("BookingCreateInput")
);
const bookingUpdateInput = registry.register(
  "BookingUpdateInput",
  updateBookingSchema.openapi("BookingUpdateInput")
);

const tripId = z.object({ id: z.string().uuid() });
const deleted = { description: "Deleted" };
const notFound = { description: "Not found", content: errorContent };
const badInput = { description: "Invalid input", content: errorContent };

/**
 * The list item carries the relation counts a card or a list row needs, so
 * a client showing N trips does not fetch N detail pages to learn how many
 * sections each has (forgejo#90 — the Companion paid exactly that N+1).
 */
const tripListItem = tripResponse.extend({
  _count: z.object({
    flights: z.number().int(),
    cruises: z.number().int(),
    lodgingStays: z.number().int(),
    routes: z.number().int().describe("Tour sections — the rows served by GET /trips/{id}/routes"),
  }),
});

registry.registerPath({
  method: "get",
  path: "/trips",
  summary: "List trips",
  description:
    "Newest first, capped at 500. Each trip carries its bookings, up to 200 " +
    "flights, cruises and stays each, and `_count` with the size of every " +
    "linked collection including tour sections (`routes`).",
  tags: ["Trips"],
  responses: {
    200: {
      description: "Trips",
      content: { "application/json": { schema: z.object({ trips: z.array(tripListItem) }) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}",
  summary: "Get a trip",
  description:
    "Includes everything linked to it: flights, cruises with their ship, ports " +
    "and stops, lodging stays with their property, stops, diary entries and photos.",
  tags: ["Trips"],
  request: { params: tripId },
  responses: {
    200: { description: "Trip", content: { "application/json": { schema: tripResponse } } },
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips",
  summary: "Create a trip",
  tags: ["Trips"],
  request: {
    body: { content: { "application/json": { schema: tripCreateInput } }, required: true },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: tripResponse } } },
    400: badInput,
  },
});

registry.registerPath({
  method: "patch",
  path: "/trips/{id}",
  summary: "Update a trip",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: tripUpdateInput } }, required: true },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: tripResponse } } },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}",
  summary: "Delete a trip",
  description:
    "The trip only. Flights, cruises and stays that pointed at it lose the link " +
    "and survive — deleting a trip is not a way to delete what happened on it.",
  tags: ["Trips"],
  request: { params: tripId },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/flights",
  summary: "Assign flights to a trip",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: assignFlightsSchema } }, required: true },
  },
  responses: {
    200: { description: "Assigned", content: { "application/json": { schema: tripResponse } } },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/stops",
  summary: "Add a stop to a trip",
  description:
    "A stop is something that happened on the trip and belongs to no other domain " +
    "— a hike, a drive, a place worth naming. Flights, cruises and stays are " +
    "linked rather than repeated here.",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: stopCreateInput } }, required: true },
  },
  responses: { 201: { description: "Created" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "patch",
  path: "/trips/{id}/stops/{stopId}",
  summary: "Update a stop",
  tags: ["Trips"],
  request: {
    params: z.object({ id: z.string().uuid(), stopId: z.string().uuid() }),
    body: { content: { "application/json": { schema: stopUpdateInput } }, required: true },
  },
  responses: { 200: { description: "Updated" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/stops/{stopId}",
  summary: "Delete a stop",
  tags: ["Trips"],
  request: { params: z.object({ id: z.string().uuid(), stopId: z.string().uuid() }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/journal",
  summary: "Add a diary entry",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: journalCreateInput } }, required: true },
  },
  responses: { 201: { description: "Created" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "patch",
  path: "/trips/{id}/journal/{entryId}",
  summary: "Update a diary entry",
  tags: ["Trips"],
  request: {
    params: z.object({ id: z.string().uuid(), entryId: z.string().uuid() }),
    body: { content: { "application/json": { schema: journalUpdateInput } }, required: true },
  },
  responses: { 200: { description: "Updated" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/journal/{entryId}",
  summary: "Delete a diary entry",
  tags: ["Trips"],
  request: { params: z.object({ id: z.string().uuid(), entryId: z.string().uuid() }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/photos",
  summary: "Upload trip photos",
  description: "multipart/form-data; several files per request.",
  tags: ["Trips"],
  request: { params: tripId },
  responses: {
    201: { description: "Uploaded" },
    400: { description: "Invalid upload", content: errorContent },
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/trips/{id}/photos/{photoId}",
  summary: "Update a photo's caption or order",
  tags: ["Trips"],
  request: { params: z.object({ id: z.string().uuid(), photoId: z.string().uuid() }) },
  responses: { 200: { description: "Updated" }, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/photos/{photoId}",
  summary: "Delete a photo",
  tags: ["Trips"],
  request: { params: z.object({ id: z.string().uuid(), photoId: z.string().uuid() }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/photos/{photoId}/file",
  summary: "Fetch a photo's bytes",
  description:
    "Ownership-checked and browser-cacheable. Sets its own `Cache-Control: private`, " +
    "overriding the API-wide `no-store` — private, never public, so a shared cache " +
    "cannot hold one user's photo.",
  tags: ["Trips"],
  request: { params: z.object({ id: z.string().uuid(), photoId: z.string().uuid() }) },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/cover",
  summary: "Set the trip's cover image",
  tags: ["Trips"],
  request: { params: tripId },
  responses: { 200: { description: "Cover set" }, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/summarize",
  summary: "Write a summary of the trip with a language model",
  description:
    "Requires a configured model. Returns text for the user to keep or discard; " +
    "this call stores nothing.",
  tags: ["Trips"],
  request: { params: tripId },
  responses: {
    200: {
      description: "Summary",
      content: { "application/json": { schema: z.object({ summary: z.string() }) } },
    },
    404: notFound,
    503: { description: "No model configured", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/detect",
  summary: "Propose trips from flights that have none",
  description:
    "A suggestion, not a write: it groups unassigned flights by closeness in time " +
    "and returns candidates. Creating them is a separate call.",
  tags: ["Trips"],
  responses: { 200: { description: "Candidate trips" } },
});

registry.registerPath({
  method: "post",
  path: "/trips/merge",
  summary: "Merge several trips into one",
  tags: ["Trips"],
  responses: {
    200: { description: "Merged", content: { "application/json": { schema: tripResponse } } },
    400: badInput,
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/cleanup/micro",
  summary: "List trips too small to be worth keeping",
  description: "Reports only; dissolving them is the separate call below.",
  tags: ["Trips"],
  responses: { 200: { description: "Micro trips" } },
});

registry.registerPath({
  method: "post",
  path: "/trips/cleanup/dissolve",
  summary: "Dissolve the named trips",
  description:
    "Removes the trips and leaves everything that pointed at them, exactly as " +
    "DELETE /trips/{id} does.",
  tags: ["Trips"],
  responses: { 200: { description: "Dissolved" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/trips/bookings",
  summary: "Create a booking",
  description:
    "A booking is one payment covering several things — the flight and the hotel " +
    "on one reference. Trip cost counts a booking once, and counts flights and " +
    "cruises carrying a price but no booking separately, so neither is doubled.",
  tags: ["Trips"],
  request: {
    body: { content: { "application/json": { schema: bookingCreateInput } }, required: true },
  },
  responses: { 201: { description: "Created" }, 400: badInput },
});

registry.registerPath({
  method: "patch",
  path: "/trips/bookings/{id}",
  summary: "Update a booking",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: bookingUpdateInput } }, required: true },
  },
  responses: { 200: { description: "Updated" }, 400: badInput, 404: notFound },
});
