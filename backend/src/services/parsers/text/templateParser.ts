import type { ProviderAvailability } from "../types";
import type { ParsedBooking } from "../../bookingParser";
import { templateRegistry } from "../templates/registry";
import { detectAirlines } from "../templates/detector";
import { applyTemplateAll } from "../templates/engine";
import type { AirlineTemplate } from "../templates/types";
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
    const count = templateRegistry.getAll().length;
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

    const candidates = detectAirlines(fromAddress, subject, html ?? "", text);
    const detectedIata = candidates[0] ?? null;
    const firstTemplate = detectedIata ? templateRegistry.getTemplate(detectedIata) : null;

    if (userId) {
      void recordParseResult({
        userId,
        airline: detectedIata ?? undefined,
        templateUsed: firstTemplate?.iata,
        templateHit: firstTemplate !== null,
        fieldCount: 0,
        missingFields: [],
        parserProvider: "template",
      });
    }

    // Each candidate in rule order; the first that reads the mail wins. A
    // template that declines hands the mail to the next one rather than
    // straight to the generic regex (see `detectAirlines`).
    for (const iata of candidates) {
      const template = templateRegistry.getTemplate(iata);
      if (!template) continue;
      if (declines(template, subject, text)) {
        logger.debug({ template: template.iata }, "template recognised a non-booking");
        return { flights: [], nonBooking: true };
      }
      const legs = applyTemplateAll(template, text, html ?? "");
      // A leg without a flight number is not a flight this template understood —
      // the LH connection mails collapsed two legs into one numberless direct
      // flight (corpus 2026-09-30). Declining lets the next reader try.
      if (legs.length === 0 || legs.some((leg) => !leg.flightNumber)) {
        logger.debug(
          { template: template.iata, legs: legs.length },
          "template declined: leg without flight number"
        );
        continue;
      }
      // A template reached only because an earlier one declined takes the
      // mail away from the generic regex, so it must read every leg whole.
      // Measured 2026-10-01: without this the general Lufthansa template,
      // second in line behind `LH-old`, answered a two-leg mail with one
      // routeless leg where the regex had at least read the route.
      if ((options.requireWholeLegs || iata !== candidates[0]) && !legs.every(isWholeLeg)) {
        logger.debug({ template: template.iata }, "fallback template declined: incomplete leg");
        continue;
      }
      // Below this the chain discards the answer anyway; a later template may
      // do better, and only when none does is the low answer handed back
      // unchanged (the chain then falls through to the regex, as before).
      if (
        (legs[0].parserConfidence ?? 0) < MIN_TEMPLATE_CONFIDENCE &&
        iata !== candidates[candidates.length - 1]
      ) {
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
}
