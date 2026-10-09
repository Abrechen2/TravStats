/**
 * Package tours → trips (plan 2026-10-09 P3): preview and commit.
 *
 * The reading itself is what a `domain: "package"` parse answers in its
 * `package` field; its names are fixed by `services/trip/package/contract.ts`.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { packageContractSchema } from "../../trip/package/contract";
import {
  PROPOSAL_REASONS,
  PROPOSAL_WARNINGS,
  packageChoicesSchema,
} from "../../trip/package/types";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const action = z.enum(["create", "attach", "skip"]);
const reason = z.enum(PROPOSAL_REASONS);

const airportCandidate = z.object({
  iata: z.string(),
  name: z.string(),
  city: z.string().nullable(),
});
const endpoint = z.object({
  iata: z.string().nullable(),
  city: z.string().nullable(),
  status: z.enum(["given", "resolved", "chosen", "ambiguous", "unknown"]),
  candidates: z.array(airportCandidate).optional(),
});

const proposal = registry.register(
  "PackageProposal",
  z
    .object({
      trip: z.object({
        action: z.enum(["create", "attach"]),
        id: z.string().uuid().nullable(),
        name: z.string(),
        startDate: day.nullable(),
        endDate: day.nullable(),
        matchedBy: z.enum(["bookingReference", "dateOverlap"]).nullable(),
      }),
      booking: z.object({
        action: z.enum(["create", "attach"]),
        id: z.string().uuid().nullable(),
        reference: z.string(),
        issuedOn: day,
        price: z.number().nullable(),
        currency: z.string().nullable(),
        travellers: z.number().int().nullable(),
        storedPrice: z
          .object({ price: z.number().nullable(), currency: z.string().nullable() })
          .optional()
          .describe("Present when the existing booking holds a different price; it is kept"),
      }),
      flights: z.array(
        z.object({
          index: z.number().int(),
          action,
          id: z.string().uuid().nullable(),
          reason: reason.optional(),
          flightNumber: z.string(),
          airline: z.string().nullable(),
          date: day,
          depTime: z.string().nullable(),
          arrTime: z.string().nullable(),
          arrDayOffset: z.number().int(),
          departure: endpoint,
          arrival: endpoint,
        })
      ),
      stays: z.array(
        z.object({
          index: z.number().int(),
          action,
          id: z.string().uuid().nullable(),
          reason: reason.optional(),
          lodging: z.object({
            action: z.enum(["create", "reuse"]),
            id: z.string().uuid().nullable(),
          }),
          name: z.string(),
          checkIn: day,
          checkOut: day,
          address: z.string().nullable(),
          city: z.string().nullable(),
          country: z.string().nullable(),
          board: z.string().nullable(),
          room: z.string().nullable(),
        })
      ),
      cruise: z
        .object({
          action,
          id: z.string().uuid().nullable(),
          reason: reason.optional(),
          ship: z.string().nullable(),
          from: z.string().nullable(),
          to: z.string().nullable(),
          cabin: z.string().nullable(),
          startDate: day.nullable(),
          endDate: day.nullable(),
        })
        .nullable(),
      document: z
        .object({
          id: z.string().uuid(),
          action: z.enum(["file", "skip"]),
          reason: z.enum(["alreadyOnTrip", "filedElsewhere"]).optional(),
        })
        .nullable(),
      warnings: z.array(z.object({ code: z.enum(PROPOSAL_WARNINGS), subject: z.string() })),
    })
    .openapi("PackageProposal")
);

const committed = z.object({
  action,
  id: z.string().uuid().nullable(),
  reason: reason.optional(),
});

const commitResult = z.object({
  trip: z.object({ action: z.enum(["create", "attach"]), id: z.string().uuid() }),
  booking: z.object({ action: z.enum(["create", "attach"]), id: z.string().uuid() }),
  flights: z.array(committed.extend({ index: z.number().int() })),
  stays: z.array(
    committed.extend({ index: z.number().int(), lodgingId: z.string().uuid().nullable() })
  ),
  cruise: committed.nullable(),
  document: z
    .object({
      id: z.string().uuid(),
      action: z.enum(["file", "skip"]),
      reason: z.string().optional(),
    })
    .nullable(),
  proposal,
});

const requestBody = z
  .object({
    reading: packageContractSchema
      .optional()
      .describe('The `package` field of a `domain: "package"` parse answer'),
    documentId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "A kept document whose stored parse is a package reading; the commit files it on the trip"
      ),
    choices: packageChoicesSchema.optional(),
  })
  .describe("Send `reading`, `documentId`, or both");

const failures = {
  400: { description: "Invalid body", content: errorContent },
  404: { description: "Document not found", content: errorContent },
  422: {
    description:
      "`PACKAGE_READING_MISSING` (the document was not parsed as a package), " +
      "`PACKAGE_READING_INVALID` (the reading breaks the contract; `issues` names the paths), " +
      "or — commit only — `PACKAGE_FLIGHT_INVALID` (one leg cannot be a flight; `field` names it)",
    content: errorContent,
  },
};

registry.registerPath({
  method: "post",
  path: "/trips/package/preview",
  summary: "Propose a trip from a package-tour reading",
  description:
    "Matches the reading against the logbook and says, per entity, whether the commit will " +
    "create it, attach an existing row to the trip and booking, or skip it — and why. The trip " +
    "is matched by booking reference, else by the one trip overlapping its days; flights by " +
    "provenance or number and local day; stays by lodging name and check-in. A place name the " +
    "airport catalogue cannot pin to one airport is reported, never guessed. Writes nothing.",
  tags: ["Trips"],
  request: { body: { content: { "application/json": { schema: requestBody } }, required: true } },
  responses: {
    200: {
      description: "The proposal",
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), data: z.object({ proposal }) }),
        },
      },
    },
    ...failures,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/package/commit",
  summary: "Write a package-tour reading as a trip",
  description:
    "Rebuilds the proposal and writes it in one transaction: trip, booking (FX on the issue " +
    "day), flights, lodgings and stays, cruise, and the document's filing on the trip. An " +
    "attached booking keeps a price it already has; an attached row keeps its booking; a row " +
    "on another trip is left where it is.",
  tags: ["Trips"],
  request: { body: { content: { "application/json": { schema: requestBody } }, required: true } },
  responses: {
    201: {
      description: "Written",
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), data: commitResult }),
        },
      },
    },
    409: { description: "The document was filed elsewhere meanwhile", content: errorContent },
    ...failures,
  },
});
