import { detectAirline } from "../../services/parsers/templates/detector";

describe("detectAirline", () => {
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
    expect(detectAirline("", "Vielen Dank für Ihre Buchung", "", "Ihr SWISS Team, swiss.com")).toBe(
      "LX"
    );
  });

  /**
   * Plan 2026-10-09 P4a: Lufthansa (both layouts), Germanwings, Emirates
   * (both layouts) and Air Berlin read their mail through v2 template files,
   * whose `match` blocks recognise the issuer. Their rules left this list, so
   * a compiled-in rule can no longer route such a mail to an older v1
   * template of the same airline.
   */
  it.each([
    ["noreply@lufthansa.com", "Buchungsbestätigung", ""],
    ["", "Buchungsdetails | 23 November 2023", ""],
    ["", "Ihre Buchung ist bestätigt", "Das Emirates-Team"],
    ["", "Germanwings Buchungsbestätigung", "Germanwings GmbH"],
    ["", "Ihre Rechnung", "Air Berlin PLC & Co. Luftverkehrs KG"],
  ])("detects no v1 rule for a v2-read airline (%s / %s)", (from, subject, text) => {
    expect(detectAirline(from, subject, "", text)).toBeNull();
  });

  it("does not take a generic subject for an airline when nothing else says so", () => {
    expect(detectAirline("", "Ihre Buchung ist bestätigt - JLNBLW", "", "Vielen Dank")).toBeNull();
  });

  it("returns null for unknown airline", () => {
    expect(detectAirline("noreply@unknown-airline.xx", "Booking", "")).toBeNull();
  });
});
