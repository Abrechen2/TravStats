import { describe, it, expect } from "@jest/globals";

import { dropNearDuplicates, pickSpread, type SpreadItem } from "../spread";
import { linksToTrim } from "../trimAuto";
import { clampPhotoCap } from "../cap";
import { browseUrl } from "../../photoSource/deepLink";

const MIN = 60_000;
const item = (key: string, minutes: number, distanceKm: number | null = 0.1): SpreadItem => ({
  key,
  at: Date.UTC(2024, 4, 1, 8) + minutes * MIN,
  distanceKm,
});

describe("pickSpread", () => {
  const day = Array.from({ length: 60 }, (_, i) => item(`p${i}`, i * 10));

  it("keeps at most the cap and spreads the picks over the whole window", () => {
    const picks = pickSpread(day, 6);
    expect(picks).toHaveLength(6);
    const hours = picks.map((p) => (p.at - day[0]!.at) / 3_600_000);
    // The first pick is in the first sixth of the span and the last in the final sixth.
    expect(hours[0]).toBeLessThan(100 / 6);
    expect(hours[5]).toBeGreaterThan(5 * (590 / 60 / 6));
    for (let i = 1; i < picks.length; i++)
      expect(picks[i]!.at - picks[i - 1]!.at).toBeGreaterThan(MIN * 30);
  });

  it("does not pick six frames of one burst when the day has more", () => {
    const burst = Array.from({ length: 30 }, (_, i) => item(`b${i}`, 0 + i / 60)); // 30 s apart... within a minute
    const later = [item("noon", 240), item("dusk", 600)];
    const keys = pickSpread([...burst, ...later], 6).map((p) => p.key);
    expect(keys).toContain("noon");
    expect(keys).toContain("dusk");
    expect(keys.filter((k) => k.startsWith("b")).length).toBeLessThanOrEqual(4);
  });

  it("prefers the closer photo inside a slot", () => {
    const picks = pickSpread([item("far", 0, 0.9), item("near", 20, 0.05), item("end", 600)], 2);
    expect(picks.map((p) => p.key)).toEqual(["near", "end"]);
  });

  it("returns everything below the cap and nothing for a cap of zero", () => {
    expect(pickSpread([item("a", 0), item("b", 30)], 6)).toHaveLength(2);
    expect(pickSpread(day, 0)).toEqual([]);
  });

  it("is deterministic", () => {
    expect(pickSpread(day, 6)).toEqual(pickSpread([...day].reverse(), 6));
  });
});

describe("dropNearDuplicates", () => {
  it("drops photos within a few seconds of a kept one, keeping the closer", () => {
    const a = { ...item("a", 0, 0.5) };
    const b = { ...item("b", 0, 0.1), at: a.at + 3_000 };
    const c = { ...item("c", 0, 0.2), at: a.at + 9_000 };
    expect(dropNearDuplicates([a, b, c]).map((i) => i.key)).toEqual(["b", "c"]);
  });
});

describe("linksToTrim", () => {
  const row = (id: string, minutes: number, provenance: string) => ({
    id,
    key: id,
    at: item(id, minutes).at,
    provenance,
  });
  const autos = Array.from({ length: 20 }, (_, i) => row(`a${i}`, i * 30, "auto"));

  it("trims automatic links to the cap and never names a user pick", () => {
    const rows = [...autos, row("mine", 5, "manual")];
    const drop = linksToTrim(rows, 6);
    expect(drop).not.toContain("mine");
    // The user's pick counts toward the cap: five automatic links stay.
    expect(autos.length - drop.length).toBe(5);
  });

  it("is idempotent: what is left needs no further trimming", () => {
    const drop = new Set(linksToTrim(autos, 6));
    const left = autos.filter((r) => !drop.has(r.id));
    expect(left).toHaveLength(6);
    expect(linksToTrim(left, 6)).toEqual([]);
  });
});

describe("cap setting bounds", () => {
  it("clamps to 5–10", () => {
    expect([0, 4, 5, 7.9, 10, 11, 99].map(clampPhotoCap)).toEqual([5, 5, 5, 7, 10, 10, 10]);
  });
});

describe("browseUrl", () => {
  const target = {
    window: { start: new Date("2024-05-01T00:00:00Z"), end: new Date("2024-05-01T23:59:59Z") },
    point: { lat: 41.9009, lon: 12.4833, radiusKm: 1.5 },
  };

  it("opens Immich's search with the date range as its JSON query", () => {
    const url = new URL(browseUrl("immich", "https://immich.example/", target)!);
    expect(url.origin + url.pathname).toBe("https://immich.example/search");
    expect(JSON.parse(url.searchParams.get("query")!)).toEqual({
      takenAfter: "2024-05-01T00:00:00.000Z",
      takenBefore: "2024-05-01T23:59:59.000Z",
    });
  });

  it("opens PhotoPrism's browse view with after/before and a lat/lng/dist radius", () => {
    const url = new URL(browseUrl("photoprism", "https://pp.example", target)!);
    expect(url.pathname).toBe("/library/browse");
    // `before` excludes its date, so it names the day after.
    expect(url.searchParams.get("q")).toBe(
      "after:2024-05-01 before:2024-05-02 lat:41.900900 lng:12.483300 dist:1.5"
    );
  });

  it("carries the dates alone when the entry has no single place", () => {
    const url = new URL(browseUrl("photoprism", "https://pp.example", { window: target.window })!);
    expect(url.searchParams.get("q")).toBe("after:2024-05-01 before:2024-05-02");
  });

  it("gives no link without a browsable base URL", () => {
    expect(browseUrl("immich", "", target)).toBeNull();
    expect(browseUrl("immich", "immich.local", target)).toBeNull();
  });
});
