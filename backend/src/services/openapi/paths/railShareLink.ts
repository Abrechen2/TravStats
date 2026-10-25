/**
 * A rail journey from a pasted link (forgejo#204). Enveloped like the rest of
 * the rail family.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { SHARE_LINK_FAILURES } from "../../rail/shareLink/dbConnection";
import { RAIL_TRAVEL_CLASSES } from "../../../schemas/rail";
import { BUS_KINDS, LEG_MODES } from "../../rail/shareLink/legMode";

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
  resolved: z.boolean().describe("True: tied to a catalogue row"),
  positionSource: z
    .enum(["catalogue", "provider"])
    .nullable()
    .describe(
      "Where lat/lon come from: the catalogue row, or bahn.de's own position for a stop the " +
        "catalogue does not hold (stationId null, still saveable). Null: no position — the " +
        "review asks the user to pick the station"
    ),
  catalogueConflictKm: z
    .number()
    .nullable()
    .describe(
      "A catalogue row with this stop's EVA number lies this many km from bahn.de's position " +
        "and was not trusted; null when none or it agrees"
    ),
});

const transit = z
  .object({
    mode: z.enum(LEG_MODES),
    busKind: z.enum(BUS_KINDS).nullable().describe("city | replacement | coach, for a bus only"),
  })
  .describe(
    "The kind of vehicle, from bahn.de's product type or else the printed name. Only rail " +
      "legs start ticked in the review; metro/tram may be saved as a rail journey of that " +
      "mode, a bus as a bus ride"
  );

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
  duplicateOf: z
    .string()
    .nullable()
    .describe(
      "A journey already logged with this departure — for a bus leg (transit.mode bus) a bus ride"
    ),
  possibleDuplicateOf: z
    .string()
    .nullable()
    .describe(
      "A bus ride that may be this leg — same stop, minute and destination, but a line one side does not name. Shown, never unticked on its strength"
    ),
  transit: transit.optional(),
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

registry.registerPath({
  method: "post",
  path: "/rail/share-link/connection",
  summary: "Read a rail journey the bookmarklet fetched on bahn.de",
  description:
    'The "In TravStats übernehmen" bookmarklet runs on bahn.de, where the user is an ' +
    "ordinary visitor, fetches the connection behind the share link there and hands the " +
    "answer over, trimmed to the sections and the `hinfahrtRecon`. No request to bahn.de is " +
    "made here: the answer is read by the same reader as POST /rail/share-link and nothing " +
    "is stored. An answer that is no readable connection is the outcome `unreadable`; one " +
    "without a train `noTrain`.",
  tags: ["Rail"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            answer: z.object({
              hinfahrtRecon: z.string().max(20_000).optional(),
              klasse: z.string().max(40).optional(),
              verbindungsAbschnitte: z.array(z.record(z.string(), z.unknown())).max(30).optional(),
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The connection read, or why not",
      content: { "application/json": { schema: envelope(outcome) } },
    },
    400: { description: "No answer in the body, or one past its bounds", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
    429: { description: "Too many lookups", content: errorContent },
  },
});
