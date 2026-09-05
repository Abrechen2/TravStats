import { detectAirline } from "../../services/parsers/templates/detector";

describe("detectAirline", () => {
  it("detects Lufthansa by from-address", () => {
    expect(detectAirline("noreply@lufthansa.com", "Buchungsbestätigung", "")).toBe("LH");
  });

  it("detects Ryanair by from-address", () => {
    expect(detectAirline("noreply@ryanair.com", "Your booking", "")).toBe("FR");
  });

  it("detects easyJet by subject pattern when the brand is in the mail", () => {
    // No from-address (a forwarded or exported mail): the subject alone is not
    // enough any more, the brand has to appear somewhere in the body.
    expect(
      detectAirline("", "Your easyJet booking confirmation", "", "Thanks for flying easyJet")
    ).toBe("U2");
  });

  it("detects an airline by a brand word in the cleaned text, with the URLs long gone", () => {
    expect(detectAirline("", "Vielen Dank für Ihre Buchung", "", "Ihr Lufthansa Team")).toBe("LH");
  });

  /**
   * 2026-09-05, owner's corpus: a forwarded Emirates confirmation with the
   * subject "Ihre Buchung ist bestätigt" was read as Lufthansa on the subject
   * rule alone. The Lufthansa template then answered ONE leg out of two with
   * confidence high enough to beat the regex parser that had found both.
   */
  it("does not take a generic subject for Lufthansa when nothing else says so", () => {
    const forwardedEmirates =
      "Von: Emirates\nBetreff: Ihre Buchung ist bestätigt - JLNBLW\nEmirates zu Ihrer sicheren Senderliste hinzufügen";
    expect(
      detectAirline("", "Ihre Buchung ist bestätigt - JLNBLW", "", forwardedEmirates)
    ).toBeNull();
  });

  it("still accepts the subject alone for the old Buchungsdetails rule, which has no fingerprint", () => {
    expect(detectAirline("", "Buchungsdetails | 23 November 2023", "", "")).toBe("LH-old");
  });

  it("returns null for unknown airline", () => {
    expect(detectAirline("noreply@unknown-airline.xx", "Booking", "")).toBeNull();
  });
});
