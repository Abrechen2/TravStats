/**
 * The document the evidence gate judges is what a person READS, not markup.
 *
 * Review of the #291 fix found the HTML half of the mail being joined into
 * the evidence source raw, so a hidden anchor nobody ever sees —
 *
 *     <a href="https://airline.example/e-ticket?utm=x" style="display:none">…</a>
 *
 * — corroborated a marketing token out of its own href. `email.ts` now passes
 * the HTML through `cleanEmailBody` first, which strips tags with their
 * attributes and then bare URLs.
 *
 * Both directions are pinned, because a fix that simply dropped the HTML
 * would pass the first test and lose every mail whose body is HTML-only.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: mockLogger,
  parserFactoryLogger: mockLogger,
  parserTextLogger: mockLogger,
  parserLogger: mockLogger,
  parserVisionLogger: mockLogger,
  httpLogger: mockLogger,
  dbLogger: mockLogger,
  securityLogger: mockLogger,
  systemLogger: mockLogger,
}));

jest.mock("../../loggingConfig", () => ({
  shouldLogParserOperations: jest.fn(async () => false),
  getLoggingConfig: jest.fn(),
}));

jest.mock("../userTemplates/matcher", () => ({
  findMatchingTemplate: jest.fn(async () => null),
  matchesFingerprint: jest.fn(),
}));

jest.mock("../text/templateParser", () => ({
  TemplateParser: class {
    async checkAvailability() {
      return { available: false, reason: "disabled in this test" };
    }
    async parseEmail() {
      return [];
    }
  },
}));

jest.mock("../../parserSettings", () => ({
  getParserOrder: jest.fn(async () => "template_first"),
}));

import { getTextParserInstance } from "../providers";
import { parseEmail } from "../email";
import type { ITextParser } from "../types";
import type { ParsedBooking } from "../../bookingParser";

jest.mock("../providers", () => ({ getTextParserInstance: jest.fn() }));

const mockedGetTextParserInstance = getTextParserInstance as jest.MockedFunction<
  typeof getTextParserInstance
>;

/**
 * A provider that answers with one lone flight number and nothing else.
 *
 * Stubbed rather than run for real, because the question here is what the
 * GATE does with the document — the candidate has to be the same in both
 * tests for the comparison to mean anything.
 */
function providerReturningFB23(): ITextParser {
  return {
    provider: "regex",
    checkAvailability: jest.fn(async () => ({ available: true })),
    // `missing` is carried because the factory's quality scoring reads it —
    // a stub without it throws inside the provider loop, and the loop turns
    // every throw into "all text parsers failed", which looks like a verdict.
    parseEmail: jest.fn(async () => [
      { airline: "FB", flightNumber: "FB23", missing: [] } as unknown as ParsedBooking,
    ]),
  } as unknown as ITextParser;
}

const config = {
  textProvider: "regex",
  textFallbacks: ["regex"],
  visionFallbacks: [],
} as never;

describe("HTML never reaches the evidence gate as markup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetTextParserInstance.mockReturnValue(providerReturningFB23());
  });

  it("refuses a marketing mail whose only anchor is a hidden href", async () => {
    // "e-ticket" IS a confirmation phrase, and it is in the href alone. The
    // reviewer's "manage-booking" link is on the next line: it must stay
    // refused too, though the phrase list already declines to read it.
    const html = [
      "<p>Unsere Facebook-Aktion FB23 läuft noch bis Freitag, 30. Oktober 2026.</p>",
      '<a href="https://airline.example/e-ticket?utm=x" style="display:none">&nbsp;</a>',
      '<a href="https://airline.example/manage-booking?utm=x" style="display:none">&nbsp;</a>',
    ].join("\n");

    const result = await parseEmail("Newsletter Oktober", "", html, config);

    expect(result.flights).toEqual([]);
  });

  it("refuses a marketing mail whose phrase sits inside a stylesheet", async () => {
    // Re-review: the generic tag pass strips MARKERS, so `<style>` content
    // survived it and `.e-ticket-banner{` matched the phrase — the hyphen is
    // a non-word character, so the closing \b was satisfied inside a CSS
    // selector. A class name is not a statement about anyone's booking.
    const html = [
      "<style>.e-ticket-banner{display:none}.boarding-pass-hero{margin:0}</style>",
      "<script>var bookingReference = 'ABC123';</script>",
      "<p>Unsere Facebook-Aktion FB23 läuft noch bis Freitag, 30. Oktober 2026.</p>",
    ].join("\n");

    const result = await parseEmail("Newsletter Oktober", "", html, config);

    expect(result.flights).toEqual([]);
  });

  it("refuses a marketing mail whose phrase sits inside an HTML comment", async () => {
    // The comment carries a `>` of its own, which ends the generic pass's
    // first "tag" early and spills the rest into the body as text. That is
    // why comments are removed explicitly rather than left to that pass.
    const html = [
      "<!-- Preis > 100 EUR. Ihre Buchungsnummer: ABC123 -->",
      "<p>Unsere Facebook-Aktion FB23 läuft noch bis Freitag, 30. Oktober 2026.</p>",
    ].join("\n");

    const result = await parseEmail("Newsletter Oktober", "", html, config);

    expect(result.flights).toEqual([]);
  });

  it("still accepts a confirmation phrase written in the HTML text", async () => {
    // Control probe. Without it, a "fix" that dropped the HTML entirely would
    // look correct here and silently break every HTML-only confirmation.
    const html = "<p>Ihre Buchungsnummer: ABC123</p>\n<p>FB23</p>";

    const result = await parseEmail("Bestätigung", "", html, config);

    expect(result.flights.map((f) => f.flightNumber)).toEqual(["FB23"]);
  });
});
