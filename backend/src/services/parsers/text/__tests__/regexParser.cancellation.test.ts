import { RegexTextParser } from "../regexParser";

jest.mock("../../../airlineCatalogCache", () => ({ getAirlineCatalogSync: () => [] }));

const parser = new RegexTextParser();

describe("cancellation notices in the regex fallback (forgejo#298)", () => {
  it("warns on the reported cancellation and marks the invented midnight", async () => {
    const [flight] = await parser.parseEmail(
      "",
      "Your flight LH2230 MUC-CDG on 10 July 2025 is cancelled.\nRefund EUR 123.45.\nReference QATEST1."
    );
    expect(flight?.airlineNotice).toBe("flight_cancellation");
    expect(flight?.inferredFields).toContain("departureTime");
  });

  it.each([
    "Your flight is canceled.",
    "Ihr Flug wurde storniert.",
    "Ihr Flug wurde leider annulliert.",
    "Flight cancellation",
  ])("recognises %s", async (notice) => {
    const [flight] = await parser.parseEmail(notice, "Flight LH2230 MUC-CDG on 10 July 2025");
    expect(flight?.airlineNotice).toBe("flight_cancellation");
  });

  it.each([
    "Booking confirmation",
    "Your flight is not cancelled.",
    "Cancellation policy: if your flight is cancelled, contact us.",
  ])("keeps a confirmation importable: %s", async (subject) => {
    const [flight] = await parser.parseEmail(
      subject,
      "Flight LH2230\nBooking reference: AB12CD\n10 July 2025\nMunich (MUC) 10:00 -> Paris (CDG) 11:35"
    );
    expect(flight?.flightNumber).toBe("LH2230");
    expect(flight?.bookingReference).toBe("AB12CD");
    expect(flight?.departureTime).toBe("2025-07-10T10:00");
    expect(flight?.inferredFields ?? []).not.toContain("departureTime");
    expect(flight?.airlineNotice).toBeUndefined();
  });

  it("does not mark an explicit midnight as invented", async () => {
    const [flight] = await parser.parseEmail(
      "",
      "Flight LH2230 MUC-CDG\n10 July 2025 00:00\n10 July 2025 02:00"
    );
    expect(flight?.departureTime).toBe("2025-07-10T00:00");
    expect(flight?.inferredFields ?? []).not.toContain("departureTime");
  });
});
