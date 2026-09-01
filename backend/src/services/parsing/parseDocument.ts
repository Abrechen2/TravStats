/**
 * One document in, one domain-shaped answer out — Forgejo #57.
 *
 * `/parse-email`, `/parse-email-file` and `/parse-pdf` each carried the same
 * three-way `if (domain === 'cruise') … if (domain === 'lodging') … else flight`
 * block, with the subject-and-text combining copied three times too. Three
 * copies of one dispatch is three places for the domains to fall out of step,
 * and a fourth entry point (an image, Forgejo #58) would have made four.
 *
 * So the dispatch lives here once, and `auto` becomes possible as a side
 * effect: resolving a domain is now one function call in front of a switch,
 * rather than a change to every route.
 *
 * ## What `auto` does and does not promise
 *
 * It classifies (`documentDomain.ts`), then parses with the winner. It does NOT
 * cascade: if the chosen parser finds nothing, the runner-up is not tried. That
 * would double the latency of the common case to rescue the rare one, and it is
 * unnecessary — the answer carries `detection.candidates`, so a client that
 * disagrees can re-ask with an explicit domain and get the other reading in one
 * further call it controls. That is the issue's own design, and it keeps the
 * decision with the user rather than burying a guess in the server.
 *
 * ## Why the subject is part of the evidence
 *
 * The classifier reads the same combined text the parsers do, subject included.
 * A booking confirmation announces itself in its subject line more reliably
 * than anywhere else — "Ihre Buchungsbestätigung AIDAnova" is decisive, and
 * scoring only the body would throw that away.
 */

import { parseBookingEmail, parseBookingText, type ParseResult } from "../bookingParser";
import { parseCruiseBookingText } from "../cruiseBookingParser";
import { resolveCruiseEntities, hydrateResolvedCruises } from "../cruiseEntityResolver";
import { parseLodgingBookingText } from "../lodging/lodgingBookingParser";
import { bookingsToCandidates } from "../lodging/lodgingCandidates";
import { PARSER_SUPPORTED_DOMAINS, type ParserSupportedDomain } from "../../shared/domains";
import { scoreDocument, type DomainDetection } from "./documentDomain";

/** What a caller may ask for. `auto` is the addition — see the header. */
export const REQUESTABLE_DOMAINS = [...PARSER_SUPPORTED_DOMAINS, "auto"] as const;
export type RequestedDomain = (typeof REQUESTABLE_DOMAINS)[number];

/**
 * Where the text came from, named for what it MEANS rather than for the route.
 *
 * `email` may carry a subject and an HTML part, and the flight parser uses both
 * — a header can date a mail whose body does not (#285). `document` is plain
 * extracted text with neither.
 */
export type DocumentSource = "email" | "document";

export interface ParseDocumentInput {
  text: string;
  subject?: string;
  html?: string;
  domain: RequestedDomain;
  source: DocumentSource;
  userId?: string;
  /**
   * When the document was sent. A confirmation writing "16 JUL" and no year is
   * read against this rather than against today (#285). Carried through here
   * because this dispatcher sits between the routes and the flight parser —
   * dropping it would silently reinstate the bug that put 2005 flights in 2026.
   */
  referenceDate?: Date;
}

type CruiseBody = {
  domain: "cruise";
  cruises: Awaited<ReturnType<typeof hydrateResolvedCruises>>;
  parserUsed: string;
  ollamaAvailable: boolean;
};

type LodgingBody = {
  domain: "lodging";
  candidates: ReturnType<typeof bookingsToCandidates>;
  parserUsed: string;
  ollamaAvailable: boolean;
  fallbackReason?: string;
};

type FlightBody = { domain: "flight" } & ParseResult;

/** The domain-shaped payload, byte-identical to what each route returned before. */
export type ParsedDocumentBody = FlightBody | CruiseBody | LodgingBody;

export interface ParseDocumentOutcome {
  /** The domain actually parsed with. */
  domain: ParserSupportedDomain;
  /**
   * Whether the caller named the domain or the server decided it. A client that
   * sent `auto` must be able to tell that a decision was made on its behalf —
   * silently answering as if it had asked for `flight` is how the "send it three
   * times" workaround survives.
   */
  domainSource: "requested" | "detected";
  /** Present only when the domain was detected: the evidence and the runners-up. */
  detection?: DomainDetection;
  body: ParsedDocumentBody;
}

/**
 * The text a parser sees. Subject first, because that is where a confirmation
 * names itself, and a blank line so the two cannot run together into a token
 * that is in neither.
 */
export function combineSubjectAndText(subject: string | undefined, text: string): string {
  return subject ? `${subject}\n\n${text}` : text;
}

/**
 * A named step rather than a ternary, because it is the one place where the
 * server decides something the caller did not — and `detection` being present
 * is exactly what marks that in the answer.
 */
function resolveDomain(
  requested: RequestedDomain,
  combined: string
): { domain: ParserSupportedDomain; detection?: DomainDetection } {
  if (requested !== "auto") return { domain: requested };
  const detection = scoreDocument(combined);
  return { domain: detection.domain, detection };
}

export async function parseDocument(input: ParseDocumentInput): Promise<ParseDocumentOutcome> {
  const combined = combineSubjectAndText(input.subject, input.text);
  const { domain, detection } = resolveDomain(input.domain, combined);

  const body = await parseAs(domain, input, combined);

  return {
    domain,
    domainSource: detection ? "detected" : "requested",
    ...(detection ? { detection } : {}),
    body,
  };
}

async function parseAs(
  domain: ParserSupportedDomain,
  input: ParseDocumentInput,
  combined: string
): Promise<ParsedDocumentBody> {
  if (domain === "cruise") {
    const result = await parseCruiseBookingText(combined);
    const resolved = await Promise.all(result.cruises.map(resolveCruiseEntities));
    return {
      domain: "cruise",
      cruises: await hydrateResolvedCruises(resolved, input.userId),
      parserUsed: result.parserUsed,
      ollamaAvailable: result.ollamaAvailable,
    };
  }

  if (domain === "lodging") {
    const result = await parseLodgingBookingText(combined);
    return {
      domain: "lodging",
      candidates: bookingsToCandidates(result.bookings),
      parserUsed: result.parserUsed,
      ollamaAvailable: result.ollamaAvailable,
      ...(result.fallbackReason !== undefined ? { fallbackReason: result.fallbackReason } : {}),
    };
  }

  // The flight parser has two entry points and they are not interchangeable:
  // the email one reads the subject and the HTML part, and a header is what
  // dates a mail whose body carries a year-less date (#285). Handing plain
  // extracted text to the email entry point would claim a subject that does
  // not exist.
  const result =
    input.source === "email"
      ? await parseBookingEmail(input.subject, input.text, input.html, {
          ...(input.userId ? { userId: input.userId } : {}),
          ...(input.referenceDate ? { referenceDate: input.referenceDate } : {}),
        })
      : await parseBookingText(input.text, input.userId);

  return { domain: "flight", ...result };
}
