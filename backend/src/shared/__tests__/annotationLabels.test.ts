import { describe, it, expect } from "@jest/globals";
import {
  WORKSHOP_DOMAINS,
  WORKSHOP_DOMAIN_SPECS,
  isLabelOfDomain,
  isWorkshopDomain,
  labelGroupsForDomain,
  labelsForDomain,
} from "../annotationLabels";
import type { LodgingFieldRules } from "../../services/lodging/templates/types";

/**
 * forgejo#124 phase 6. The mirror at `frontend/src/shared/annotationLabels.ts`
 * has its own copy of these assertions — nothing checks the two files against
 * each other, which is the standing gap CLAUDE.md names for every mirrored
 * rule in `shared/`.
 */
describe("the workshop's per-domain label sets", () => {
  it("covers every workshop domain, with no empty set", () => {
    for (const domain of WORKSHOP_DOMAINS) {
      expect(labelsForDomain(domain).length).toBeGreaterThan(0);
    }
  });

  it("names no label twice inside one domain", () => {
    for (const domain of WORKSHOP_DOMAINS) {
      const ids = labelsForDomain(domain).map((label) => label.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("borrows the lodging vocabulary from the phase 4 field rules, not a second list", () => {
    // The type is erased at runtime, so the check is written the other way
    // round: every lodging label must be assignable as a `LodgingFieldRules`
    // key, which `tsc` enforces here and a test could not.
    const keys: Array<keyof LodgingFieldRules> = labelsForDomain("lodging").map(
      (label) => label.id as keyof LodgingFieldRules
    );
    expect(keys).toContain("hotelName");
    expect(keys).toContain("checkIn");
    expect(keys).toContain("checkOut");
  });

  it("says which domains can be derived, and why the others cannot", () => {
    expect(WORKSHOP_DOMAIN_SPECS.flight.derivable).toBe(true);
    expect(WORKSHOP_DOMAIN_SPECS.lodging.derivable).toBe(true);
    // Not a stub and not a silent nothing: each carries the reason the UI
    // shows instead of a template.
    expect(WORKSHOP_DOMAIN_SPECS.cruise).toMatchObject({
      derivable: false,
      reason: "cruiseNeedsRepeatingBlocks",
    });
    expect(WORKSHOP_DOMAIN_SPECS.place).toMatchObject({
      derivable: false,
      reason: "noPlaceDocumentReader",
    });
  });

  it("keeps a label inside its own domain", () => {
    expect(isLabelOfDomain("flight", "flightNumber")).toBe(true);
    expect(isLabelOfDomain("lodging", "flightNumber")).toBe(false);
    expect(isLabelOfDomain("lodging", "checkIn")).toBe(true);
    expect(isLabelOfDomain("flight", "checkIn")).toBe(false);
  });

  it("groups labels in the order they are first used", () => {
    expect(labelGroupsForDomain("lodging")).toEqual([
      "property",
      "stay",
      "place",
      "money",
      "booking",
    ]);
  });

  it("recognises only the four workshop domains", () => {
    expect(isWorkshopDomain("lodging")).toBe(true);
    expect(isWorkshopDomain("tour")).toBe(false);
  });
});
