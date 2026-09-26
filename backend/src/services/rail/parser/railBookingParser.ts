import logger from "../../../utils/logger";
import { llmRefusalFor } from "../../llm/llmGate";
import { getParserOrder } from "../../parserSettings";
import { isLlmAvailable, recordLlmProbe } from "../../parsers/llmAvailability";
import { cleanEmailBody } from "../../parsers/shared/utils";
import { extractTextFromPdf } from "../../pdfParser";
import {
  dbOrderFacts,
  parseDbConfirmation,
  parseDbConnectionInfo,
  parseDbPostalOrder,
} from "./dbConfirmation";
import { parseDbOnlineTicket } from "./dbOnlineTicket";
import { decodeCalendar, isCalendarAttachment, parseCalendarLegs } from "./icsCalendar";
import { ollamaReachable, parseRailWithOllama, resolveOllamaTarget } from "./railLlmParser";
import { conclusiveOtherDomain, scoreDocument } from "../../parsing/documentDomain";
import type { ParsedRailBooking, ParsedRailLeg, RailAttachment } from "./types";

/**
 * Template first, the model only for what no template reads — the order and
 * the failure rules of the lodging parser, with one difference: every way of
 * finding nothing carries its own stable CODE, because the review dialog
 * says it in the reader's language and a server sentence is English
 * (CLAUDE.md, "a failure must reach the user as itself").
 */

export type RailParserUsed = "template" | "ollama" | "none";

export type RailFallbackCode =
  /** A DB order mail with reference/total but no itinerary (it is in the PDF). */
  | "noItinerary"
  /** The configured model did not answer the availability check. */
  | "llmUnreachable"
  /** The model answered, but with something that is not a rail booking. */
  | "llmFailed"
  /** The model read the document and found no provable ride. */
  | "llmFoundNothing"
  /** The shared demo account never reaches the model. */
  | "demoNoLlm"
  /** An admin has switched the language model off (`services/llm/llmGate.ts`). */
  | "llmDisabled"
  /** The document is clearly another domain (a flight, a stay, a cruise). */
  | "otherDomain"
  /** The model answered with airport codes for stations — a flight read as a train. */
  | "looksLikeFlight";

export interface RailParseResult {
  booking: ParsedRailBooking | null;
  parserUsed: RailParserUsed;
  ollamaAvailable: boolean;
  fallbackCode?: RailFallbackCode;
  /** English, for the log. The UI reads `fallbackCode`. */
  fallbackReason?: string;
  /** What a legless DB mail DID say — so the review can name the order. */
  orderReference?: string | null;
}

/** Attachments beyond this are not read: a booking carries one or two. */
const MAX_ATTACHMENTS = 6;

const isPdf = (a: RailAttachment): boolean =>
  /\.pdf$/i.test(a.filename ?? "") || /application\/pdf/i.test(a.mediaType);

async function attachmentTexts(
  attachments: readonly RailAttachment[]
): Promise<{ pdfs: string[]; calendars: string[] }> {
  const pdfs: string[] = [];
  const calendars: string[] = [];
  for (const attachment of attachments.slice(0, MAX_ATTACHMENTS)) {
    if (isCalendarAttachment(attachment.filename, attachment.mediaType)) {
      calendars.push(decodeCalendar(attachment.content));
    } else if (isPdf(attachment)) {
      try {
        pdfs.push(await extractTextFromPdf(attachment.content));
      } catch (err) {
        // One unreadable attachment is not a reason to lose the others.
        logger.warn(
          { operation: "rail_attachment_unreadable", err: (err as Error).message },
          "[Rail Parser] An attached PDF could not be read"
        );
      }
    }
  }
  return { pdfs, calendars };
}

const legKey = (leg: ParsedRailLeg): string =>
  `${leg.depStationName.toLowerCase()}|${leg.departureLocal}`;

/**
 * Fill a leg's train from a second source that names the same departure —
 * the calendar file, or a ticket — and never overwrite one already read.
 */
function fillTrains(legs: ParsedRailLeg[], others: ParsedRailLeg[]): ParsedRailLeg[] {
  const byKey = new Map(others.filter((o) => o.trainNumber).map((o) => [legKey(o), o]));
  return legs.map((leg) => {
    if (leg.trainNumber) return leg;
    const other = byKey.get(legKey(leg));
    return other
      ? { ...leg, trainCategory: other.trainCategory, trainNumber: other.trainNumber }
      : leg;
  });
}

function dedupeLegs(legs: ParsedRailLeg[]): ParsedRailLeg[] {
  const seen = new Set<string>();
  return legs.filter((leg) => {
    const key = `${legKey(leg)}|${leg.arrStationName.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The first reader that recognises the text itself as a booking. */
function readBody(text: string): ParsedRailBooking | null {
  return (
    parseDbConfirmation(text) ??
    parseDbOnlineTicket(text) ??
    parseDbPostalOrder(text) ??
    parseDbConnectionInfo(text)
  );
}

/**
 * Every template over the text and the attachments. The per-train ticket
 * wins for the legs (it names each train); the mail wins for the order's
 * reference and total (it covers every ticket of the order); the calendar
 * file supplies legs only when nothing else does, and trains where it has one.
 */
export async function readRailTemplates(
  text: string,
  attachments: readonly RailAttachment[] = []
): Promise<{ booking: ParsedRailBooking | null; orderReference: string | null }> {
  const body = readBody(text);
  const { pdfs, calendars } = await attachmentTexts(attachments);
  const tickets = pdfs
    .map((pdf) => parseDbOnlineTicket(pdf) ?? parseDbConfirmation(pdf))
    .filter((t): t is ParsedRailBooking => t !== null);
  const calendarLegs = calendars.flatMap(parseCalendarLegs);
  const facts = dbOrderFacts(text);

  const ticketLegs = dedupeLegs(tickets.flatMap((t) => t.legs));
  const legs =
    ticketLegs.length > 0 ? ticketLegs : body && body.legs.length > 0 ? body.legs : calendarLegs;
  if (legs.length === 0) {
    return { booking: null, orderReference: facts?.bookingReference ?? null };
  }
  const primary = tickets[0] ?? body;
  const source = ticketLegs.length > 0 ? tickets[0].source : body ? body.source : "ics";
  const first = <K extends keyof ParsedRailBooking>(key: K): ParsedRailBooking[K] | null =>
    [body, ...tickets].map((b) => b?.[key] ?? null).find((v) => v !== null) ?? null;
  const price = body?.price ?? facts?.price ?? primary?.price ?? null;
  const currency =
    body?.price !== null && body?.price !== undefined
      ? body.currency
      : facts?.price !== null && facts?.price !== undefined
        ? facts.currency
        : (primary?.currency ?? null);
  return {
    booking: {
      bookingReference: first("bookingReference") ?? facts?.bookingReference ?? null,
      travelClass: first("travelClass"),
      tariff: first("tariff"),
      price,
      currency: price !== null ? currency : null,
      operator: first("operator"),
      legs: fillTrains(legs, [...calendarLegs, ...ticketLegs]),
      source,
    },
    orderReference: facts?.bookingReference ?? null,
  };
}

/** "MUC", "FRA": three capitals are an airport code, never a printed station name. */
const IATA_LIKE = /^[A-Z]{3}$/;

/**
 * A model answer whose legs run between airport codes is a flight read as a
 * train (acceptance D1: MUC→FRA and back, offered as "Mücka" and "Frant").
 * Refused whole rather than leg by leg — one such leg says what the document is.
 */
export function legsLookLikeFlights(legs: readonly ParsedRailLeg[]): boolean {
  return legs.some(
    (leg) => IATA_LIKE.test(leg.depStationName.trim()) || IATA_LIKE.test(leg.arrStationName.trim())
  );
}

export async function parseRailBookingText(
  text: string,
  attachments: readonly RailAttachment[] = [],
  userId?: string
): Promise<RailParseResult> {
  const order = await getParserOrder();
  const templates = await readRailTemplates(text, attachments);
  const llmQuery = userId !== undefined ? { userId } : {};
  const noItinerary = {
    fallbackCode: "noItinerary" as const,
    fallbackReason: "The order mail names no ride; its itinerary is in the attached ticket",
    orderReference: templates.orderReference,
  };

  if (order === "template_first" && templates.booking) {
    return {
      booking: templates.booking,
      parserUsed: "template",
      ollamaAvailable: await isLlmAvailable(llmQuery),
    };
  }

  const fromTemplate = (ollamaAvailable: boolean): RailParseResult | null =>
    templates.booking
      ? { booking: templates.booking, parserUsed: "template", ollamaAvailable }
      : null;

  // The admin switch and the shared-demo denial, asked in the one place every
  // parser asks them (`llmGate.ts`) — the rail fallback is a model call too.
  const refusal = await llmRefusalFor(userId);
  if (refusal) {
    return (
      fromTemplate(false) ?? {
        booking: null,
        parserUsed: "none",
        ollamaAvailable: false,
        fallbackCode: refusal.kind === "shared_demo" ? "demoNoLlm" : "llmDisabled",
        fallbackReason: refusal.reason,
      }
    );
  }

  // The model runs only where the document may be a rail booking: it finds
  // "rides" in anything it is given, so a document the classifier clearly
  // places elsewhere never reaches it.
  if (conclusiveOtherDomain(scoreDocument(text), "rail") !== null) {
    const available = await isLlmAvailable(llmQuery);
    return (
      fromTemplate(available) ?? {
        booking: null,
        parserUsed: "none",
        ollamaAvailable: available,
        fallbackCode: "otherDomain",
        fallbackReason: "The document reads as another kind of booking, not a rail ticket",
      }
    );
  }

  const target = await resolveOllamaTarget();
  const reachable = await ollamaReachable(target.url);
  recordLlmProbe(target.url, reachable);
  if (!reachable) {
    return (
      fromTemplate(false) ?? {
        booking: null,
        parserUsed: "none",
        ollamaAvailable: false,
        // A legless DB mail says so before blaming the model: its itinerary is
        // in the ticket either way.
        ...(templates.orderReference
          ? noItinerary
          : {
              fallbackCode: "llmUnreachable" as const,
              fallbackReason: `Ollama is not reachable at ${target.url}`,
            }),
      }
    );
  }

  try {
    const booking = await parseRailWithOllama(cleanEmailBody(text), target);
    if (booking && legsLookLikeFlights(booking.legs)) {
      return (
        fromTemplate(true) ?? {
          booking: null,
          parserUsed: "none",
          ollamaAvailable: true,
          fallbackCode: "looksLikeFlight",
          fallbackReason: "The AI parser answered with airport codes for station names",
        }
      );
    }
    if (booking) return { booking, parserUsed: "ollama", ollamaAvailable: true };
    return (
      fromTemplate(true) ?? {
        booking: null,
        parserUsed: "none",
        ollamaAvailable: true,
        ...(templates.orderReference
          ? noItinerary
          : {
              fallbackCode: "llmFoundNothing" as const,
              fallbackReason: "The AI parser read this document and found no rail ride in it",
            }),
      }
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), model: target.model },
      "[Rail Parser] Ollama parse failed"
    );
    return (
      fromTemplate(true) ?? {
        booking: null,
        parserUsed: "none",
        ollamaAvailable: true,
        fallbackCode: "llmFailed",
        fallbackReason: err instanceof Error ? err.message : String(err),
      }
    );
  }
}
