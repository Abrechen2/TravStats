import { LODGING_SYSTEM_PROMPT } from "../lodgingBookingParser";

/**
 * Prompt-contract pins from the HX Antarctica booking (2026-08-21): the
 * lodging parser resolved "18. Februar 27" to 2026 (anchored on the letter
 * date "18. Januar 26") and returned the print/document number from the page
 * margin as the confirmation number instead of the labelled booking number.
 */
describe("lodging parser system prompt", () => {
  it("resolves two-digit years against the stay, never the letter date", () => {
    expect(LODGING_SYSTEM_PROMPT).toMatch(/two-digit year[\s\S]{0,300}(stay|travel)/i);
    expect(LODGING_SYSTEM_PROMPT).toMatch(/never[\s\S]{0,120}(letter|booking|print) date/i);
    expect(LODGING_SYSTEM_PROMPT).toContain('"18. Februar 27" -> "2027-02-18"');
  });

  it("takes only an explicitly labelled booking number, never header/margin numbers", () => {
    expect(LODGING_SYSTEM_PROMPT).toMatch(/confirmationNumber[\s\S]{0,400}labelled/i);
    expect(LODGING_SYSTEM_PROMPT).toMatch(/never[\s\S]{0,200}(document|print|customer) number/i);
  });
});
