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
import { bodyNamesNoRoute, readFlightsFromPdfAttachments } from "../parsers/pdfAttachmentFlights";
import { parseCruiseBookingText } from "../cruiseBookingParser";
import { resolveCruiseEntities, hydrateResolvedCruises } from "../cruiseEntityResolver";
import { parseLodgingBookingText } from "../lodging/lodgingBookingParser";
import { bookingsToCandidates } from "../lodging/lodgingCandidates";
import { parseRailBookingText, type RailFallbackCode } from "../rail/parser/railBookingParser";
import { toRailCandidate, type RailImportCandidate } from "../rail/parser/railCandidates";
import type { RailAttachment } from "../rail/parser/types";
import {
  parseRentalBookingText,
  type RentalFallbackCode,
} from "../rental/parser/rentalBookingParser";
import { toRentalCandidate, type RentalImportCandidate } from "../rental/parser/rentalCandidates";
import { PARSER_SUPPORTED_DOMAINS, type ParserSupportedDomain } from "../../shared/domains";
import { isLlmAvailable } from "../parsers/llmAvailability";
import { conclusiveOtherDomain, scoreDocument, type DomainDetection } from "./documentDomain";
import { isLlmEnabledByAdmin } from "../llm/llmGate";
import { describeLlmTarget, resolveLlmTarget, type LlmProviderInfo } from "../llm/llmProvider";

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
  /**
   * Files that came with a mail — a calendar file, a PDF ticket. Only the rail
   * reader looks at them: a DB booking mail prints its itinerary nowhere else.
   */
  attachments?: RailAttachment[];
  /**
   * The sender address, where the format carries it. Only the rental reader
   * looks at it: a provider's template is chosen by who sent the mail.
   */
  from?: string;
  /**
   * The mail's own send time (its Date header) — never a caller's anchor.
   * Only the rental reader looks at it: of two mails of one booking, the
   * newer one's data stands, whatever order they are imported in.
   */
  sentAt?: Date;
}

/**
 * The document clearly is something other than what the dialog asked for
 * (acceptance D1, 2026-09-26). Additive: the body keeps the requested shape
 * with an empty result, so a client that does not read this field still sees
 * "nothing read" rather than a misreading, and one that does can send the
 * user to the right import.
 */
export interface DomainMismatch {
  detected: ParserSupportedDomain;
  confidence: number;
}

type CruiseBody = {
  domain: "cruise";
  cruises: Awaited<ReturnType<typeof hydrateResolvedCruises>>;
  parserUsed: string;
  ollamaAvailable: boolean;
  /** Present when nothing was read — the same field lodging answers with. */
  fallbackReason?: string;
  domainMismatch?: DomainMismatch;
};

type LodgingBody = {
  domain: "lodging";
  candidates: ReturnType<typeof bookingsToCandidates>;
  parserUsed: string;
  ollamaAvailable: boolean;
  fallbackReason?: string;
  domainMismatch?: DomainMismatch;
};

type FlightBody = { domain: "flight" } & ParseResult;

type RailBody = {
  domain: "rail";
  /** One booking per document; empty when nothing was read — see `fallbackCode`. */
  bookings: RailImportCandidate[];
  parserUsed: string;
  ollamaAvailable: boolean;
  /** Why nothing was read, as a stable code the client words in its own language. */
  fallbackCode?: RailFallbackCode;
  fallbackReason?: string;
  /** A DB order mail's reference when it printed no ride — the ride is in its ticket. */
  orderReference?: string | null;
  domainMismatch?: DomainMismatch;
};

type RentalBody = {
  domain: "rental";
  /** One candidate per document; empty when nothing was read — see `fallbackCode`. */
  candidates: RentalImportCandidate[];
  parserUsed: string;
  ollamaAvailable: boolean;
  fallbackCode?: RentalFallbackCode;
  fallbackReason?: string;
  domainMismatch?: DomainMismatch;
};

type DomainBody = FlightBody | CruiseBody | LodgingBody | RailBody | RentalBody;

/**
 * The domain-shaped payload, plus one field every domain shares:
 * `llmDisabledByAdmin`, so a templates-only answer can say it was a decision
 * (`services/llm/llmGate.ts`) rather than an unreachable model — which is what
 * `ollamaAvailable: false` alone cannot tell apart.
 */
export type ParsedDocumentBody = DomainBody & {
  llmDisabledByAdmin: boolean;
  /**
   * The provider that read the document, when the language model did
   * (`parserUsed === "ollama"` — the historical name for "the model read it",
   * whichever provider that is). Null otherwise. A cloud provider is named by
   * host, so the user sees where their booking went.
   */
  llmProvider: LlmProviderInfo | null;
};

async function llmProviderFor(parserUsed: string): Promise<LlmProviderInfo | null> {
  if (parserUsed !== "ollama") return null;
  const target = await resolveLlmTarget({ withDefaults: true });
  return target ? describeLlmTarget(target) : null;
}

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

/**
 * The dialogs whose choice detection may overrule. `flight` is not among them:
 * it is what a caller that names no domain gets (the Companion and every older
 * client), and those clients read `flights` — answering them in another shape
 * would break them. A flight request keeps its historical behaviour.
 */
const OVERRULABLE_DOMAINS: readonly ParserSupportedDomain[] = [
  "rail",
  "cruise",
  "lodging",
  "rental",
];

/**
 * Detection runs first and independently of the dialog: a document that is
 * clearly another domain is not forced through the requested parser — least
 * of all through a model fallback that will find "train rides" in anything.
 */
function mismatchFor(
  requested: RequestedDomain,
  domain: ParserSupportedDomain,
  combined: string
): DomainMismatch | null {
  if (requested === "auto" || !OVERRULABLE_DOMAINS.includes(domain)) return null;
  const detection = scoreDocument(combined);
  const other = conclusiveOtherDomain(detection, domain);
  return other ? { detected: other, confidence: detection.confidence } : null;
}

async function mismatchBody(
  domain: ParserSupportedDomain,
  mismatch: DomainMismatch,
  userId: string | undefined
): Promise<DomainBody> {
  const ollamaAvailable = await isLlmAvailable(userId !== undefined ? { userId } : {});
  const common = {
    parserUsed: "none",
    ollamaAvailable,
    // English, for the log; the client words it from `domainMismatch`.
    fallbackReason: `The document reads as a ${mismatch.detected} booking, not ${domain}`,
    domainMismatch: mismatch,
  };
  if (domain === "rail") return { domain, bookings: [], fallbackCode: "otherDomain", ...common };
  if (domain === "rental")
    return { domain, candidates: [], fallbackCode: "otherDomain", ...common };
  if (domain === "cruise") return { domain, cruises: [], ...common };
  return { domain: "lodging", candidates: [], ...common };
}

export async function parseDocument(input: ParseDocumentInput): Promise<ParseDocumentOutcome> {
  const combined = combineSubjectAndText(input.subject, input.text);
  const { domain, detection } = resolveDomain(input.domain, combined);

  const mismatch = mismatchFor(input.domain, domain, combined);
  const domainBody = mismatch
    ? await mismatchBody(domain, mismatch, input.userId)
    : await parseAs(domain, input, combined);
  const body = {
    ...domainBody,
    llmDisabledByAdmin: !(await isLlmEnabledByAdmin()),
    llmProvider: await llmProviderFor(domainBody.parserUsed),
  };

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
): Promise<DomainBody> {
  if (domain === "cruise") {
    // The userId is what lets the parser refuse the ADMIN's Ollama to the
    // shared demo account (security audit of 2026-09-19, finding 3). The flight
    // branch below already carried it, for templates; the two booking parsers
    // did not carry it at all, which is why it had to be threaded here.
    const result = await parseCruiseBookingText(combined, undefined, input.userId);
    const resolved = await Promise.all(result.cruises.map(resolveCruiseEntities));
    return {
      domain: "cruise",
      cruises: await hydrateResolvedCruises(resolved, input.userId),
      parserUsed: result.parserUsed,
      ollamaAvailable: result.ollamaAvailable,
      ...(result.fallbackReason !== undefined ? { fallbackReason: result.fallbackReason } : {}),
    };
  }

  if (domain === "lodging") {
    const result = await parseLodgingBookingText(combined, undefined, input.userId);
    return {
      domain: "lodging",
      candidates: bookingsToCandidates(result.bookings),
      parserUsed: result.parserUsed,
      ollamaAvailable: result.ollamaAvailable,
      ...(result.fallbackReason !== undefined ? { fallbackReason: result.fallbackReason } : {}),
    };
  }

  if (domain === "rail") {
    const result = await parseRailBookingText(combined, input.attachments ?? [], input.userId);
    return {
      domain: "rail",
      bookings: result.booking ? [await toRailCandidate(result.booking, input.userId)] : [],
      parserUsed: result.parserUsed,
      ollamaAvailable: result.ollamaAvailable,
      ...(result.fallbackCode !== undefined ? { fallbackCode: result.fallbackCode } : {}),
      ...(result.fallbackReason !== undefined ? { fallbackReason: result.fallbackReason } : {}),
      ...(result.orderReference ? { orderReference: result.orderReference } : {}),
    };
  }

  if (domain === "rental") {
    // Template or decline (spec 2026-10-01-rental-domain-design §4) — the
    // model path arrives with package R3. The candidate knows whether the
    // booking already exists, so the review can say "update", never "new".
    const result = await parseRentalBookingText(input.text, {
      subject: input.subject,
      from: input.from ?? null,
      attachments: input.attachments ?? [],
    });
    const candidate = result.document
      ? await toRentalCandidate(
          result.document,
          result.parserTemplate ?? "template",
          input.userId,
          input.sentAt
        )
      : null;
    return {
      domain: "rental",
      candidates: candidate ? [candidate] : [],
      parserUsed: result.parserUsed,
      ollamaAvailable: await isLlmAvailable(
        input.userId !== undefined ? { userId: input.userId } : {}
      ),
      ...(result.fallbackCode !== undefined ? { fallbackCode: result.fallbackCode } : {}),
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

  // A mail whose body named no route may carry its itinerary in a PDF — Air
  // Berlin's invoices, for one (see `pdfAttachmentFlights.ts`).
  // Only a template reading whole legs replaces the body's answer.
  if (input.source === "email" && input.attachments?.length && bodyNamesNoRoute(result.flights)) {
    const fromPdf = await readFlightsFromPdfAttachments(
      input.subject ?? "",
      input.attachments,
      input.userId
    );
    if (fromPdf.length > 0) {
      // The body's "the model could not be asked" no longer qualifies an
      // empty answer — the answer is not empty.
      const { llmUnreachable: _unused, ...rest } = result;
      return { domain: "flight", ...rest, flights: fromPdf, parserUsed: "regex" };
    }
  }

  return { domain: "flight", ...result };
}
