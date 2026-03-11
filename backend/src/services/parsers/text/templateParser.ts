import type { ProviderAvailability } from "../types";
import type { ParsedBooking } from "../../bookingParser";
import { templateRegistry } from "../templates/registry";
import { detectAirline } from "../templates/detector";
import { applyTemplate } from "../templates/engine";
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

    const detectedIata = detectAirline(fromAddress, subject, html ?? "");
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

    const parsed = applyTemplate(template, text, html ?? "");
    parsed.airlineNotice = buildAirlineNotice(detectedIata);
    return [parsed];
  }
}
