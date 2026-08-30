/**
 * Import + parsing endpoints (email, PDF, boarding pass).
 */

import { z } from "zod";

import { registry } from "../registry";
import { parseEmailSchema } from "../../../schemas/parseEmail";
import { errorContent, flightCreateInput, flightResponse } from "./shared";

const parsedFlightSchema = registry.register(
  "ParsedFlight",
  z
    .object({
      airline: z.string().nullable(),
      flightNumber: z.string().nullable(),
      depIata: z.string().nullable(),
      arrIata: z.string().nullable(),
      departureTime: z.string().nullable(),
      arrivalTime: z.string().nullable(),
      seatNumber: z.string().nullable().optional(),
      bookingReference: z.string().nullable().optional(),
      passengerName: z.string().nullable().optional(),
    })
    .openapi("ParsedFlight")
);

registry.registerPath({
  method: "post",
  path: "/parse-email",
  summary: "Extract flights from email content",
  description:
    "Sends raw email body (text or HTML, up to 10 MB) through the LLM/regex " +
    "parser pipeline and returns one or more structured flight candidates. " +
    "Useful for AI agents that receive forwarded booking confirmations and " +
    "want to drop them into TravStats without writing per-airline regexes. " +
    "The result is NOT auto-saved — combine with `POST /flights?merge=true` " +
    "to persist with duplicate-aware enrichment.",
  tags: ["Parsers"],
  request: {
    body: {
      content: {
        "application/json": {
          // The route's OWN schema, not a copy of it. The copy that used to
          // stand here listed two of its four fields, so `domain` was
          // invisible and there was no way to see that the email's own date
          // could be supplied.
          schema: parseEmailSchema.openapi("ParseEmailRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Parsed flights",
      content: {
        "application/json": {
          schema: z.object({
            flights: z.array(parsedFlightSchema),
            parserUsed: z.string(),
            subject: z.string().optional(),
          }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    429: { description: "Rate-limited (parser is expensive)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/parse-boardingpass",
  summary: "Extract a flight from a boarding-pass image",
  description:
    "Accepts a base64-encoded boarding-pass image (PNG/JPEG/PDF, up to 20 MB). " +
    "Tries QR/PDF417 barcode decoding first, then OCR + vision LLM as fallback. " +
    "Like /parse-email, the result is NOT auto-saved.",
  tags: ["Parsers"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              imageBase64: z.string().min(1).max(20 * 1024 * 1024),
              enrichWithApi: z.boolean().default(true).optional(),
            })
            .openapi("ParseBoardingpassRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Parsed flight",
      content: {
        "application/json": {
          schema: z.object({
            flight: parsedFlightSchema,
            provider: z.string(),
            fallbackUsed: z.boolean().optional(),
            enriched: z.boolean().optional(),
          }),
        },
      },
    },
    400: { description: "Validation failed or invalid image", content: errorContent },
    429: { description: "Rate-limited", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/flights/batch",
  summary: "Create multiple flights atomically",
  description:
    "Insert up to 20 flights in a single transaction. Shared booking " +
    "references are auto-grouped into a Trip + Booking row, so a forwarded " +
    "round-trip confirmation lands as one trip with two flights. Each entry " +
    "uses the same shape as `POST /flights`. Errors abort the whole batch — " +
    "no partial inserts.",
  tags: ["Flights"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.array(flightCreateInput).min(1).max(20),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Flights created",
      content: {
        "application/json": {
          schema: z.object({
            flights: z.array(flightResponse),
            tripIds: z.array(z.string().uuid()).optional(),
          }),
        },
      },
    },
    400: { description: "Batch too large or any entry invalid", content: errorContent },
    429: { description: "Rate-limited (batch is heavy)", content: errorContent },
  },
});
