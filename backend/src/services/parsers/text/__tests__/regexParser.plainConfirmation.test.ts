import { RegexTextParser } from "../regexParser";

/**
 * A plain confirmation with no template, read without an LLM (browser check
 * of forgejo#159, 2026-10-02, synthetic QA text): the generic reader took the
 * flight number "LH2230" as the booking reference, because it was the first
 * six-character code with a digit, and turned the date-only line into a
 * 00:00 departure with no arrival, though both times stood on the route line.
 */
describe("generic reader on a plain one-flight confirmation", () => {
  const parser = new RegexTextParser();
  const text = [
    "Lufthansa flight LH2230",
    "Passenger: Alice Tester",
    "Booking reference: QATEST1",
    "10 July 2025",
    "Munich (MUC) 10:00 -> Paris (CDG) 11:35",
    "Seat 12A",
    "Total EUR 123.45",
  ].join("\n");

  it("takes the labelled booking reference, never the flight number", async () => {
    const [flight] = await parser.parseEmail("", text, undefined);
    expect(flight?.flightNumber).toBe("LH2230");
    expect(flight?.bookingReference).toBe("QATEST1");
  });

  it("puts the route line's two times on the one date", async () => {
    const [flight] = await parser.parseEmail("", text, undefined);
    expect(flight?.departureTime).toBe("2025-07-10T10:00");
    expect(flight?.arrivalTime).toBe("2025-07-10T11:35");
  });

  it("moves an arrival before the departure to the next day", async () => {
    const overnight = text.replace("10:00 -> Paris (CDG) 11:35", "22:10 -> Paris (CDG) 00:40");
    const [flight] = await parser.parseEmail("", overnight, undefined);
    expect(flight?.departureTime).toBe("2025-07-10T22:10");
    expect(flight?.arrivalTime).toBe("2025-07-11T00:40");
  });

  it("does not take a flight number for the PNR when no label names one", async () => {
    const unlabelled = text.replace("Booking reference: QATEST1\n", "");
    const [flight] = await parser.parseEmail("", unlabelled, undefined);
    expect(flight?.bookingReference).not.toBe("LH2230");
  });

  it("leaves two time lines alone: which pair belongs to the date is a guess", async () => {
    const twoLines = text.replace("Seat 12A", "Boarding 09:20 - gate closes 09:40");
    const [flight] = await parser.parseEmail("", twoLines, undefined);
    expect(flight?.arrivalTime ?? null).toBeNull();
  });
});
