/**
 * A rail journey from a pasted link (forgejo#204). Enveloped like the rest of
 * the rail family.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { SHARE_LINK_FAILURES } from "../../rail/shareLink/dbConnection";
import { RAIL_TRAVEL_CLASSES } from "../../../schemas/rail";

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

const facts = z
  .object({
    departureStationName: z.string().nullable(),
    arrivalStationName: z.string().nullable(),
    departureLocal: z.string().nullable().describe("YYYY-MM-DDTHH:mm, the station's wall clock"),
    travelClass: z.enum(RAIL_TRAVEL_CLASSES).nullable(),
  })
  .describe("What the link itself carried — reliable whatever the fetch did");

const station = z.object({
  name: z.string(),
  printedName: z.string(),
  stationId: z.number().int().nullable(),
  code: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  country: z.string().nullable(),
  timezone: z.string().nullable(),
  resolved: z.boolean().describe("False: the review asks the user to pick the station"),
});

const leg = z.object({
  depStationName: z.string(),
  arrStationName: z.string(),
  departureLocal: z.string(),
  arrivalLocal: z.string().nullable(),
  trainCategory: z.string().nullable(),
  trainNumber: z.string().nullable(),
  coach: z.string().nullable(),
  seat: z.string().nullable(),
  direction: z.enum(["outbound", "return"]).nullable(),
  departureStation: station,
  arrivalStation: station,
  duplicateOf: z.string().nullable().describe("A journey already logged with this departure"),
});

const booking = z.object({
  bookingReference: z.string().nullable(),
  travelClass: z.enum(RAIL_TRAVEL_CLASSES).nullable(),
  tariff: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  operator: z.string().nullable(),
  source: z.literal("db-share-link"),
  legs: z.array(leg),
});

const outcome = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("read"), facts, booking }),
  z.object({
    outcome: z.literal("failed"),
    reason: z.enum([...SHARE_LINK_FAILURES, "noConnectionInLink"]),
    facts,
  }),
]);

registry.registerPath({
  method: "post",
  path: "/rail/share-link",
  summary: "Read a rail journey from a bahn.de link",
  description:
    "A bahn.de share link (`?vbid=…`) is fetched once from bahn.de, bounded by a timeout and " +
    "a body cap; a search link (`#so=…&zo=…&hd=…`) is read without a request. Nothing is " +
    "stored: a read connection is returned for the rail review, each leg then saved through " +
    "POST /rail. A failure is an outcome with its reason — `blocked` when bahn.de's bot " +
    "protection refused the request, which is the usual answer today — plus the facts the " +
    "link itself carried, for the next step.",
  tags: ["Rail"],
  request: {
    body: {
      content: { "application/json": { schema: z.object({ url: z.string().max(2000) }) } },
    },
  },
  responses: {
    200: {
      description: "The connection read, or why not",
      content: { "application/json": { schema: envelope(outcome) } },
    },
    400: { description: "No link in the body", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
    429: { description: "Too many lookups", content: errorContent },
  },
});
