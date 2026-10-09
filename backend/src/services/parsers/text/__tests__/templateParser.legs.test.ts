import fs from "fs";
import path from "path";
import { TemplateParser } from "../templateParser";
import { templateRegistry } from "../../templates/registry";
import type { AirlineTemplate } from "../../templates/types";

/**
 * The Lufthansa information mails for a connection carry the legs only in
 * `.ics` attachments; reading the attachments is package 2. Until then, a
 * leg without a flight number is not a flight this template understood — the
 * template must decline rather than hand back a wrong, numberless "direct
 * flight" (corpus 2026-09-30).
 *
 * Built from `LH-old.json`'s own test case: the subject that gets the mail
 * detected as `LH-old`, and its `testCases[0].input` with the flight-number
 * line removed.
 */
const TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "templates",
  "__tests__",
  "fixtures",
  "v1-airlines",
  "LH-old.json"
);
const TEMPLATE = JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf-8")) as AirlineTemplate;
const TEST_CASE = TEMPLATE.testCases[0];

// LH-old is detected purely from the subject ("Buchungsdetails"/"Booking
// details") — see detector.ts — so any subject matching that pattern works.
const SUBJECT = "Buchungsdetails";

describe("TemplateParser — a leg without a flight number", () => {
  beforeAll(async () => {
    await templateRegistry.initialize();
  });

  it("declines instead of returning a leg without a flight number", async () => {
    const parser = new TemplateParser();
    // Remove the "LH 2316" flight-number line from the template's own
    // test-case input.
    const inputWithoutFlightNumber = TEST_CASE.input
      .split("\n")
      .filter((line) => !/^LH\s?\d{1,4}$/.test(line.trim()))
      .join("\n");
    expect(inputWithoutFlightNumber).not.toContain("LH 2316");

    const result = await parser.parseEmail(SUBJECT, inputWithoutFlightNumber, "");
    expect(result).toEqual([]);
  });

  it("still reads the template's own complete test case", async () => {
    const parser = new TemplateParser();
    const result = await parser.parseEmail(SUBJECT, TEST_CASE.input, "");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => Boolean(r.flightNumber))).toBe(true);
  });
});
