import { describe, it, expect } from "vitest";
import {
  WORKSHOP_DOMAINS,
  WORKSHOP_DOMAIN_SPECS,
  isLabelOfDomain,
  isWorkshopDomain,
  labelOfDomain,
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

  it("derives every workshop domain since the v2 engine reads repeating blocks", () => {
    // forgejo#124: cruise and place were `derivable: false` until a reader
    // existed. A domain added later without one sets it back, with a reason.
    for (const domain of WORKSHOP_DOMAINS) {
      expect(WORKSHOP_DOMAIN_SPECS[domain].derivable).toBe(true);
      expect(WORKSHOP_DOMAIN_SPECS[domain].reason).toBeUndefined();
    }
  });

  it("offers the cruise itinerary labels one marked row is read from", () => {
    expect(labelOfDomain("cruise", "stopDate")).toEqual({
      id: "stopDate",
      group: "itinerary",
      kind: "date",
    });
    expect(isLabelOfDomain("cruise", "stopPort")).toBe(true);
    expect(isLabelOfDomain("cruise", "seaDay")).toBe(true);
    expect(isLabelOfDomain("lodging", "stopPort")).toBe(false);
    expect(labelOfDomain("place", "stopDate")).toBeUndefined();
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

  it("recognises only the workshop domains", () => {
    expect(isWorkshopDomain("lodging")).toBe(true);
    expect(isWorkshopDomain("package")).toBe(true);
    expect(isWorkshopDomain("tour")).toBe(false);
  });

  it("offers the package contract's booking fields and one flight and one hotel row", () => {
    expect(labelOfDomain("package", "issuedOn")).toEqual({
      id: "issuedOn",
      group: "booking",
      kind: "date",
    });
    expect(labelGroupsForDomain("package")).toEqual([
      "booking",
      "packageTrip",
      "money",
      "flightRow",
      "stayRow",
    ]);
    expect(isLabelOfDomain("package", "flightDepIata")).toBe(true);
    expect(isLabelOfDomain("package", "stayCheckOut")).toBe(true);
    expect(isLabelOfDomain("flight", "stayCheckOut")).toBe(false);
  });
});
