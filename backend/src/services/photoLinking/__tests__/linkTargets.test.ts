import { describe, it, expect } from "@jest/globals";

import { DOMAIN_KEYS } from "../../../shared/domains";
import { PHOTO_LINK_TARGETS } from "../linkTargets";

describe("photo link target registry", () => {
  it("classifies every domain, so a new entry type cannot silently go without photos", () => {
    expect(Object.keys(PHOTO_LINK_TARGETS).sort()).toEqual([...DOMAIN_KEYS].sort());
  });

  it("gives every unwired domain a written reason and fit", () => {
    for (const target of Object.values(PHOTO_LINK_TARGETS)) {
      if (!target.wired) expect(target.reason.length).toBeGreaterThan(10);
      expect(target.fit.length).toBeGreaterThan(5);
    }
  });
});

describe("wired targets name a kind the entry pass knows", () => {
  it("every wired non-visit entry is an ENTRY_KIND, and every kind is wired", async () => {
    const { ENTRY_KINDS } = await import("../entryKinds");
    const wired = Object.values(PHOTO_LINK_TARGETS).flatMap((t) => (t.wired ? [t.entry] : []));
    expect(wired.filter((e) => e !== "placeVisit").sort()).toEqual([...ENTRY_KINDS].sort());
  });
});
