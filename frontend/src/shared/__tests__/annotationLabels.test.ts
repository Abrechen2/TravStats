import { describe, it, expect } from "vitest";
import {
  WORKSHOP_DOMAINS,
  WORKSHOP_DOMAIN_SPECS,
  isLabelOfDomain,
  isWorkshopDomain,
  labelGroupsForDomain,
  labelsForDomain,
} from "../annotationLabels";

/**
 * The mirror half of `backend/src/shared/__tests__/annotationLabels.test.ts`.
 *
 * Same truth table, asserted on this side's copy — which is the whole
 * convention for a mirrored rule in `shared/`: nothing compares the two
 * files, so each side has to be pinned where it lives. The header of both
 * modules says this test exists; for one review round it did not, which is
 * the same class of untrue claim as documenting an invariant nobody tests.
 */
describe("the workshop's per-domain label sets (frontend mirror)", () => {
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

  it("carries the lodging vocabulary of the declarative readers", () => {
    const ids = labelsForDomain("lodging").map((label) => label.id);
    expect(ids).toContain("hotelName");
    expect(ids).toContain("checkIn");
    expect(ids).toContain("checkOut");
  });

  it("says which domains can be derived, and why the others cannot", () => {
    expect(WORKSHOP_DOMAIN_SPECS.flight.derivable).toBe(true);
    expect(WORKSHOP_DOMAIN_SPECS.lodging.derivable).toBe(true);
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
