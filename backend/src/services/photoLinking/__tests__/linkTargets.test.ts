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
