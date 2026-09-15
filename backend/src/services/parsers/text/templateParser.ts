import type { ProviderAvailability } from "../types";
import type { ParsedBooking } from "../../bookingParser";
import { templateRegistry } from "../templates/registry";
import { detectAirline } from "../templates/detector";
import { applyTemplateAll } from "../templates/engine";
import { buildAirlineNotice, recordParseResult } from "../../trainingRecorder";
import logger from "../../../utils/logger";

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
    const fromMatch = /^From:\s*(.+)$/im.exec(text);
    const fromAddress = fromMatch ? fromMatch[1].trim() : "";

    const detectedIata = detectAirline(fromAddress, subject, html ?? "", text);
    const template = detectedIata ? templateRegistry.getTemplate(detectedIata) : null;

    if (userId) {
      void recordParseResult({
        userId,
        airline: detectedIata ?? undefined,
        templateUsed: template?.iata,
        templateHit: template !== null,
        fieldCount: 0,
        missingFields: [],
        parserProvider: "template",
      });
    }

    if (!template) {
      logger.debug({ detectedIata, subject }, "No template found for airline");
      return [];
    }

    // One booking per leg where the template knows how a mail is segmented
    // (see `AirlineTemplate.segments`); one booking otherwise, as before.
    const notice = buildAirlineNotice(detectedIata);
    return applyTemplateAll(template, text, html ?? "").map((parsed) => ({
      ...parsed,
      airlineNotice: notice,
    }));
  }
}
