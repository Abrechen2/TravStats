import { describe, it, expect } from "vitest";

import { domainSlices } from "../CrossDomainHeatmap";
import { DOMAINS, type DomainKey } from "../../../../shared/domains";

const colorOf = (d: DomainKey): string => DOMAINS[d].color;

/**
 * A day can hold a flight AND a hotel night AND a place visit.
 *
 * The cell used to paint only whichever was largest, so half of a busy day was
 * invisible and the grid quietly under-reported the mixed ones (Alex,
 * 2026-08-29).
 */
describe("domainSlices", () => {
  it("splits in proportion to what happened, not into equal parts", () => {
    // Two flights and one stay is not the same day as one flight and two
    // stays; equal thirds would draw them identically.
    const slices = domainSlices({ flight: 2, lodging: 1 }, colorOf);

    expect(slices).toHaveLength(2);
    expect(slices[0]).toMatchObject({ domain: "flight", from: 0 });
    expect(slices[0].to).toBeCloseTo(66.67, 1);
    expect(slices[1]).toMatchObject({ domain: "lodging", to: 100 });
  });

  it("closes the last band at exactly 100", () => {
    // Three thirds round to 99.99 and leave a hairline of the cell background
    // showing through the bottom edge.
    const slices = domainSlices({ flight: 1, cruise: 1, lodging: 1 }, colorOf);

    expect(slices[slices.length - 1].to).toBe(100);
  });

  it("orders bands by the domain table, not by size", () => {
    // A grid whose stripes reorder row by row is unreadable even when every
    // individual cell is correct.
    const a = domainSlices({ poi: 9, flight: 1 }, colorOf).map((s) => s.domain);
    const b = domainSlices({ flight: 9, poi: 1 }, colorOf).map((s) => s.domain);

    expect(a).toEqual(b);
  });

  it("leaves out a domain that did not happen that day", () => {
    const slices = domainSlices({ flight: 1, cruise: 0 }, colorOf);

    expect(slices.map((s) => s.domain)).toEqual(["flight"]);
    expect(slices[0]).toMatchObject({ from: 0, to: 100 });
  });

  it("returns nothing for an empty day", () => {
    expect(domainSlices({}, colorOf)).toEqual([]);
    expect(domainSlices({ flight: 0 }, colorOf)).toEqual([]);
  });

  it("takes its colours from the resolver, so a user's choice reaches the grid", () => {
    const slices = domainSlices({ flight: 1 }, () => "#00ff00");
    expect(slices[0].hex).toBe("#00ff00");
  });
});
