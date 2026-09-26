import type { Document } from "../../prisma";
import { z } from "../../schemas/zod";
import { RAIL_TRAVEL_CLASSES } from "../../schemas/rail";
import type { ParserSupportedDomain } from "../../shared/domains";
import logger from "../../utils/logger";
import type { ParsedDocumentBody } from "../parsing/parseDocument";
import { valuesOf, type ExtractedValues, type LegHints } from "./documentValues";

/**
 * The values of the reading ALREADY stored on a document (forgejo#132 item 3).
 *
 * A parse by id, a retained parse and `extract-values` all record their body in
 * `parsedPayload`. Until now nothing gave it back, so a client that wanted to
 * show "12A, 1.234,50 €" ran the parser again — spending its budget and, with
 * the LLM on, a minute — to learn what the server already knew. This reads the
 * stored body with the same `valuesOf` the live route uses, and never parses.
 *
 * The payload is JSON from the database, written by whichever parser version
 * ran then: it is a boundary. The parts `valuesOf` reads are checked; a body
 * that does not have them is logged and answers `unreadable` — never an
 * invented or partly-read value.
 */

const record = z.record(z.string(), z.unknown());
const maybeText = z.string().nullish();

const storedBodySchema = z.discriminatedUnion("domain", [
  z
    .object({
      domain: z.literal("flight"),
      flights: z.array(
        z.object({ flightNumber: maybeText, departureTime: maybeText }).passthrough()
      ),
    })
    .passthrough(),
  z
    .object({
      domain: z.literal("rail"),
      bookings: z.array(
        z
          .object({
            travelClass: z.enum(RAIL_TRAVEL_CLASSES).nullish(),
            legs: z.array(
              z.object({ departureLocal: z.string(), trainNumber: maybeText }).passthrough()
            ),
          })
          .passthrough()
      ),
    })
    .passthrough(),
  z
    .object({
      domain: z.literal("cruise"),
      cruises: z.array(z.object({ input: record }).passthrough()),
    })
    .passthrough(),
  z
    .object({
      domain: z.literal("lodging"),
      candidates: z.array(z.object({ stay: record.nullish() }).passthrough()),
    })
    .passthrough(),
]);

export type StoredReadingReason = "notParsed" | "unreadable" | "nothingFound";

export interface StoredReading {
  /** The domain the stored reading was parsed as; null when there is none to read. */
  domain: ParserSupportedDomain | null;
  parserUsed: string | null;
  /** Null when the reading holds none of the values — said plainly, not as empty fields. */
  values: ExtractedValues | null;
  /** Why `values` is null: never parsed, a stored body of an unknown shape, or nothing in it. */
  reason: StoredReadingReason | null;
}

type ReadingColumns = Pick<Document, "id" | "parsedPayload">;

export function storedReading(document: ReadingColumns, hints: LegHints = {}): StoredReading {
  if (document.parsedPayload === null || document.parsedPayload === undefined) {
    return { domain: null, parserUsed: null, values: null, reason: "notParsed" };
  }
  const parsed = storedBodySchema.safeParse(document.parsedPayload);
  if (!parsed.success) {
    logger.warn(
      {
        operation: "document_stored_reading",
        documentId: document.id,
        issues: parsed.error.issues.length,
      },
      "Stored parse reading has an unexpected shape; its values are not offered"
    );
    return { domain: null, parserUsed: null, values: null, reason: "unreadable" };
  }
  const values = valuesOf(parsed.data as unknown as ParsedDocumentBody, hints);
  const found = Object.values(values).some((v) => v !== null && v !== undefined);
  const parserUsed = (parsed.data as { parserUsed?: unknown }).parserUsed;
  return {
    domain: parsed.data.domain,
    parserUsed: typeof parserUsed === "string" ? parserUsed : null,
    values: found ? values : null,
    reason: found ? null : "nothingFound",
  };
}
