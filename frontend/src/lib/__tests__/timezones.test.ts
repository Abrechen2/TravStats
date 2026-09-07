import { describe, it, expect } from "vitest";
import { groupTimeZones, listTimeZones } from "../timezones";

describe("listTimeZones", () => {
  // #318: the settings offered exactly six zones, so anyone outside Berlin,
  // Paris, New York, Los Angeles or Singapore could not say where they are.
  it("offers far more than the six zones the settings used to hardcode", () => {
    expect(listTimeZones().length).toBeGreaterThan(100);
  });

  it("includes zones from every inhabited region", () => {
    const zones = listTimeZones();
    for (const zone of [
      "UTC",
      "Europe/Berlin",
      "America/Sao_Paulo",
      "Africa/Nairobi",
      "Asia/Tokyo",
      "Australia/Sydney",
      "Pacific/Auckland",
    ]) {
      expect(zones).toContain(zone);
    }
  });

  // Runtimes disagree on the LEGACY names: this Node lists India as
  // "Asia/Calcutta" while Chrome canonicalises it to "Asia/Kolkata". Both are
  // the same zone, so the list is asserted to carry one of them rather than a
  // particular spelling — and `listTimeZones(selected)` is what keeps a stored
  // spelling the runtime does not offer from vanishing out of the select.
  it("carries India under whichever spelling the runtime uses", () => {
    const zones = listTimeZones();
    expect(zones.includes("Asia/Kolkata") || zones.includes("Asia/Calcutta")).toBe(true);
  });

  it("sorts them, and lists each one once", () => {
    const zones = listTimeZones();
    expect([...zones].sort((a, b) => a.localeCompare(b, "en"))).toEqual(zones);
    expect(new Set(zones).size).toBe(zones.length);
  });

  // A `<select>` whose value is not among its options renders blank, which
  // reads as "no timezone set" while the account has one.
  it("keeps a stored zone the browser does not know", () => {
    expect(listTimeZones("Mars/Olympus_Mons")).toContain("Mars/Olympus_Mons");
  });
});

describe("groupTimeZones", () => {
  it("groups by region and puts UTC in one of its own", () => {
    const groups = groupTimeZones();
    const regions = groups.map((g) => g.region);
    expect(regions).toContain("Europe");
    expect(regions).toContain("UTC");
    const utc = groups.find((g) => g.region === "UTC");
    expect(utc?.zones).toContain("UTC");
  });

  it("loses no zone in the grouping", () => {
    const flat = groupTimeZones().flatMap((g) => g.zones);
    expect(flat.length).toBe(listTimeZones().length);
  });
});
