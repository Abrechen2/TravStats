import { describe, it, expect } from "vitest";
import { filterEmailText } from "../filterEmailText";

describe("filterEmailText", () => {
  it("drops a From line whose address it just removed", () => {
    // The husk is worse than the missing line: the parser workshop's `^From:`
    // read matched it, captured nothing, and reported a sample that names its
    // sender as having none (beta audit 2026-09-19, NOT FIXED 5). Who sent a
    // training sample is kept on the row now, read from the real headers at
    // upload, so this line has no reader left to mislead.
    const filtered = filterEmailText(
      [
        "From: reservierung@hotel-seeblick.test",
        "Subject: Buchung",
        "",
        "Anreise: 10. März 2026",
      ].join("\n")
    );
    expect(filtered).not.toContain("From:");
    expect(filtered).toContain("Subject: Buchung");
    expect(filtered).toContain("Anreise: 10. März 2026");
  });

  it("still removes an address that stands in the prose", () => {
    const filtered = filterEmailText(
      "Fragen an rezeption@hotel-seeblick.test beantworten wir gern"
    );
    expect(filtered).not.toContain("@");
    expect(filtered).toContain("Fragen an");
  });
});
