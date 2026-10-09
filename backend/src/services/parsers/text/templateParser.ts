import type { ProviderAvailability } from "../types";
import type { ParsedBooking } from "../../bookingParser";
import { templateRegistry } from "../templates/registry";
import { detectAirlines } from "../templates/detector";
import { applyTemplateAll } from "../templates/engine";
import type { AirlineTemplate } from "../templates/types";
import { applyV2FlightTemplate, flightTemplateName } from "../templates/v2Flight";
import { envelopeMatches, testInputHaystack } from "../templates/v2/runners";
import type { TemplateEnvelope } from "../templates/v2/envelope";
import { buildAirlineNotice, recordParseResult } from "../../trainingRecorder";
import logger from "../../../utils/logger";

/**
 * What the template layer made of a mail.
 *
 * `nonBooking` is the one answer a template can give that is stronger than
 * "I could not read this": a sender's own cancellation or change notice,
 * recognised by the template's `declineIf`. The caller ends the chain there —
 * the generic regex would otherwise read the cancelled flight's number and
 * route and propose it as a booking.
 */
export interface TemplateReading {
  flights: ParsedBooking[];
  nonBooking: boolean;
}

/** The lowest confidence `parseEmail` in `email.ts` accepts a template's answer at. */
export const MIN_TEMPLATE_CONFIDENCE = 30;

function declines(template: AirlineTemplate, subject: string, text: string): boolean {
  const haystack = `${subject}\n${text}`;
  return (template.declineIf ?? []).some((pattern) => {
    try {
      return new RegExp(pattern, "im").test(haystack);
    } catch {
      return false;
    }
  });
}

export interface ReadOptions {
  /**
   * Accept a template's answer only when every leg is whole — also from the
   * first template. For a document no other reader will look at again, such
   * as a mail's PDF attachment, a partial leg has no better reading to lose
   * to, so it must not be proposed at all.
   */
  requireWholeLegs?: boolean;
}

/** A leg with its number, both airports and its departure. */
function isWholeLeg(leg: ParsedBooking): boolean {
  return Boolean(leg.flightNumber && leg.departureCode && leg.arrivalCode && leg.departureTime);
}

/**
 * Whether a template's legs may answer the mail. The same three rules for v2
 * template files and v1 airline templates:
 *  - a leg without a flight number is not a flight the template understood —
 *    the LH connection mails collapsed two legs into one numberless direct
 *    flight (corpus 2026-09-30);
 *  - a template reached only because an earlier one declined takes the mail
 *    away from the generic regex, so it must read every leg whole. Measured
 *    2026-10-01: without this the general Lufthansa template, second in line
 *    behind `LH-old`, answered a two-leg mail with one routeless leg where
 *    the regex had at least read the route;
 *  - below the chain's confidence floor a later template may do better, and
 *    only the last candidate's low answer is handed back unchanged (the chain
 *    then falls through to the regex, as before).
 */
function accepts(
  legs: ParsedBooking[],
  position: { first: boolean; last: boolean },
  options: ReadOptions
): boolean {
  if (legs.length === 0 || legs.some((leg) => !leg.flightNumber)) return false;
  if ((options.requireWholeLegs || !position.first) && !legs.every(isWholeLeg)) return false;
  return (legs[0].parserConfidence ?? 0) >= MIN_TEMPLATE_CONFIDENCE || position.last;
}

/**
 * Zero-width characters out of the text a template reads.
 *
 * Lufthansa's 2015 mails print every clock time as "07:55" with a
 * zero-width space (U+200B) between each digit, invisible on screen. No time
 * pattern matches through them, so `LH-old` declined those mails and the
 * generic regex read a wrong flight number instead (private mailbox,
 * 2026-10-01). They carry no meaning in any confirmation.
 */
const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0xfeff]);

function withoutZeroWidth(text: string): string {
  return Array.from(text)
    .filter((ch) => !ZERO_WIDTH.has(ch.codePointAt(0) ?? 0))
    .join("");
}

export class TemplateParser {
  async checkAvailability(): Promise<ProviderAvailability> {
    const count = templateRegistry.getAll().length + templateRegistry.getActiveV2("flight").length;
    return {
      available: count > 0,
      reason: count === 0 ? "No templates loaded" : undefined,
    };
  }

  async parseEmail(
    subject: string,
    text: string,
    html: string | undefined,
    userId?: string
  ): Promise<ParsedBooking[]> {
    return (await this.read(subject, text, html, userId)).flights;
  }

  async read(
    subject: string,
    rawText: string,
    html: string | undefined,
    userId?: string,
    options: ReadOptions = {}
  ): Promise<TemplateReading> {
    const text = withoutZeroWidth(rawText);
    const fromMatch = /^From:\s*(.+)$/im.exec(text);
    const fromAddress = fromMatch ? fromMatch[1].trim() : "";

    // v2 template files first (plan 2026-10-09 P4a): each recognises its own
    // issuer through `match`, so the compiled-in detection list only routes
    // the v1 airline templates no v2 file has replaced yet.
    const v2Templates = templateRegistry.getActiveV2("flight");
    const v2Names = new Set(v2Templates.map(flightTemplateName));
    const input = { subject, text };
    const haystack = testInputHaystack(input);
    const v2Matching = v2Templates.filter((t) => envelopeMatches(t, haystack));

    const candidates = detectAirlines(fromAddress, subject, html ?? "", text).filter(
      (iata) => !v2Names.has(iata)
    );
    const detectedIata = candidates[0] ?? null;
    const firstTemplate = detectedIata ? templateRegistry.getTemplate(detectedIata) : null;
    const firstV2 = v2Matching[0];

    if (userId) {
      void recordParseResult({
        userId,
        airline: firstV2
          ? (firstV2.issuer.keys?.iata ?? flightTemplateName(firstV2))
          : (detectedIata ?? undefined),
        templateUsed: firstV2 ? flightTemplateName(firstV2) : firstTemplate?.iata,
        templateHit: firstV2 !== undefined || firstTemplate !== null,
        fieldCount: 0,
        missingFields: [],
        parserProvider: "template",
      });
    }

    const v2Reading = this.readV2(v2Matching, input, options);
    if (v2Reading) return v2Reading;

    // Each candidate in rule order; the first that reads the mail wins. A
    // template that declines hands the mail to the next one rather than
    // straight to the generic regex (see `detectAirlines`).
    for (const [i, iata] of candidates.entries()) {
      const template = templateRegistry.getTemplate(iata);
      if (!template) continue;
      if (declines(template, subject, text)) {
        logger.debug({ template: template.iata }, "template recognised a non-booking");
        return { flights: [], nonBooking: true };
      }
      const legs = applyTemplateAll(template, text, html ?? "");
      const position = { first: i === 0, last: i === candidates.length - 1 };
      if (!accepts(legs, position, options)) {
        logger.debug({ template: template.iata, legs: legs.length }, "template declined the mail");
        continue;
      }
      const notice = buildAirlineNotice(iata);
      return {
        flights: legs.map((parsed) => ({ ...parsed, airlineNotice: notice })),
        nonBooking: false,
      };
    }

    logger.debug({ detectedIata, subject }, "No template read the mail");
    return { flights: [], nonBooking: false };
  }

  /** The first matching v2 flight template whose legs the chain accepts, or null. */
  private readV2(
    matching: readonly TemplateEnvelope[],
    input: { subject: string; text: string },
    options: ReadOptions
  ): TemplateReading | null {
    for (const [i, template] of matching.entries()) {
      const outcome = applyV2FlightTemplate(template, input);
      if (outcome.kind === "nonBooking") {
        logger.debug({ template: template.id }, "v2 template recognised a non-booking");
        return { flights: [], nonBooking: true };
      }
      if (outcome.kind === "declined") continue;
      const position = { first: i === 0, last: i === matching.length - 1 };
      if (!accepts(outcome.legs, position, options)) {
        logger.debug({ template: template.id }, "v2 template declined the mail");
        continue;
      }
      const notice = buildAirlineNotice(flightTemplateName(template));
      return {
        flights: outcome.legs.map((leg) => ({ ...leg, airlineNotice: notice })),
        nonBooking: false,
      };
    }
    return null;
  }
}
