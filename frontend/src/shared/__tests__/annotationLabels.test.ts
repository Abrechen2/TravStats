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

  it("offers the rail booking fields and one leg row (forgejo#309)", () => {
    expect(isWorkshopDomain("rail")).toBe(true);
    expect(labelGroupsForDomain("rail")).toEqual(["booking", "money", "railLeg"]);
    expect(labelOfDomain("rail", "departureTime")).toEqual({
      id: "departureTime",
      group: "railLeg",
      kind: "time",
    });
    expect(isLabelOfDomain("rail", "depStation")).toBe(true);
    expect(isLabelOfDomain("rail", "train")).toBe(true);
    expect(isLabelOfDomain("flight", "depStation")).toBe(false);
  });

  it("offers each rental end's station, day and clock (forgejo#309)", () => {
    expect(isWorkshopDomain("rental")).toBe(true);
    expect(labelGroupsForDomain("rental")).toEqual([
      "booking",
      "rentalPickup",
      "rentalReturn",
      "vehicle",
      "money",
    ]);
    expect(labelOfDomain("rental", "pickupTime")).toEqual({
      id: "pickupTime",
      group: "rentalPickup",
      kind: "time",
    });
    expect(isLabelOfDomain("rental", "returnStation")).toBe(true);
    expect(isLabelOfDomain("rail", "returnStation")).toBe(false);
  });
  it("offers one bus ride row and one ferry crossing row (forgejo#309)", () => {
    expect(isWorkshopDomain("bus")).toBe(true);
    expect(isWorkshopDomain("ferry")).toBe(true);
    expect(labelGroupsForDomain("bus")).toEqual(["booking", "money", "busRide"]);
    expect(labelGroupsForDomain("ferry")).toEqual(["booking", "money", "ferryCrossing"]);
    expect(labelOfDomain("bus", "depStop")).toEqual({
      id: "depStop",
      group: "busRide",
      kind: "text",
    });
    expect(isLabelOfDomain("bus", "line")).toBe(true);
    expect(isLabelOfDomain("ferry", "vessel")).toBe(true);
    expect(isLabelOfDomain("ferry", "depStop")).toBe(false);
    expect(isLabelOfDomain("rail", "depPort")).toBe(false);
  });
});
