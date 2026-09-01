/**
 * Import + parsing endpoints (email, PDF, boarding pass).
 */

import { z } from "zod";

import { registry } from "../registry";
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

/**
 * The evidence behind an automatic domain decision. Shared by every route that
 * accepts `domain: "auto"`, because a client should learn to read it once.
 */
const domainDetectionSchema = registry.register(
  "DomainDetection",
  z
    .object({
      domain: z.enum(["flight", "cruise", "lodging"]),
      confidence: z.number().min(0).max(1),
      candidates: z.array(
        z.object({
          domain: z.enum(["flight", "cruise", "lodging"]),
          score: z.number(),
          confidence: z.number(),
          matched: z.array(z.string()).describe("Signal ids that fired, e.g. \"checkin-checkout\""),
        })
      ),
    })
    .openapi("DomainDetection")
);

const requestableDomain = z
  .enum(["flight", "cruise", "lodging", "auto"])
  .describe(
    "'auto' lets the server decide what the document is and report the evidence. " +
      "Text routes default to 'flight' for backwards compatibility; /parse-image " +
      "defaults to 'auto', because a photograph has no caller history to preserve."
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
          schema: z
            .object({
              emailContent: z.string().min(1).max(10 * 1024 * 1024),
              subject: z.string().max(1000).optional(),
              domain: requestableDomain.default("flight").optional(),
            })
            .openapi("ParseEmailRequest"),
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
  path: "/parse-image",
  summary: "Read any travel document from a photograph",
  description:
    "OCRs a photographed booking confirmation and parses it as a flight, a " +
    "cruise or a hotel stay. Until this existed an image could only ever become " +
    "a flight: the boarding-pass routes are flight-only, and /parse-pdf handles " +
    "all three domains but needs text and refuses a scan — so a photographed " +
    "hotel bill had no way in. This is only the missing step in front of the " +
    "existing parsers, pixels to text; the parsing itself is the same dispatcher " +
    "/parse-pdf and /parse-email use. " +
    "Accepts JPEG, PNG, GIF or WebP up to 10 MB decoded. `ocrConfidence` is " +
    "reported but never used as a gate — it describes the glyphs, not whether " +
    "the document parsed. The result is NOT auto-saved.",
  tags: ["Parsers"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              imageBase64: z.string().min(1).max(20 * 1024 * 1024),
              domain: requestableDomain.default("auto").optional(),
            })
            .openapi("ParseImageRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The domain-shaped parse result, plus OCR metadata",
      content: {
        "application/json": {
          schema: z.object({
            domain: z.enum(["flight", "cruise", "lodging"]),
            ocrConfidence: z.number(),
            ocrTextLength: z.number(),
            domainSource: z
              .enum(["requested", "detected"])
              .optional()
              .describe("Present only when the server decided the domain"),
            detection: domainDetectionSchema.optional(),
          }),
        },
      },
    },
    400: { description: "Validation failed or unsupported image", content: errorContent },
    422: { description: "Almost no text could be read from the image", content: errorContent },
    429: { description: "Rate-limited (OCR is expensive)", content: errorContent },
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
