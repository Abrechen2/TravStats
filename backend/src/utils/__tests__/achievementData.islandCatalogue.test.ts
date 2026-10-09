/**
 * The island catalogue holds only airports that are on an island (forgejo#253).
 * Madrid, Malaga, Thessaloniki, Da Nang, Ho Chi Minh City and Aksu are on a
 * continent; each used to count towards Island Hopper.
 */
import { ISLAND_AIRPORTS } from "../achievementData";

describe("ISLAND_AIRPORTS — only airports on an island (forgejo#253)", () => {
  it.each([
    ["MAD", "Madrid — Iberian mainland"],
    ["AGP", "Malaga — Iberian mainland"],
    ["SKG", "Thessaloniki — Greek mainland"],
    ["DAD", "Da Nang — Vietnamese mainland"],
    ["SGN", "Ho Chi Minh City — Vietnamese mainland"],
    ["AKU", "Aksu — inland Xinjiang"],
  ])("does not list %s (%s)", (code) => {
    expect(ISLAND_AIRPORTS.has(code)).toBe(false);
  });

  it.each(["HNL", "OGG", "PMI", "TFS", "MLE", "KEF", "NRT", "HKG", "DPS", "CGK", "CMB", "TPE"])(
    "lists the island airport %s",
    (code) => {
      expect(ISLAND_AIRPORTS.has(code)).toBe(true);
    }
  );
});
