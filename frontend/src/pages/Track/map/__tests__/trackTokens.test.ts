import { afterEach, describe, expect, it } from "vitest";
import { spanText } from "../trackLegFormat";
import { stopOutlineOf } from "../trackMapLayers";
import { parseCssColor, tokenRgb } from "../trackTokenRgb";

const t = (key: string, o?: Record<string, unknown>) =>
  o ? `${key}:${Object.values(o).join("|")}` : key;

describe("spanText: a span to the end of the day ends at 24:00, not 00:00", () => {
  it("names the end of day where the zone's day turns over", () => {
    const from = Date.parse("2026-10-12T20:00:00Z");
    const midnight = Date.parse("2026-10-13T00:00:00Z");
    expect(spanText(from, midnight, "UTC", t)).toContain("track:timeline.endOfDay");
    expect(spanText(from, midnight - 60_000, "UTC", t)).not.toContain("endOfDay");
  });
});

describe("stop marker colours come from the theme tokens", () => {
  afterEach(() => document.documentElement.removeAttribute("style"));

  it("resolves a token from the page, hex or rgb()", () => {
    document.documentElement.style.setProperty("--ts-surface", "#f0f8ff");
    expect(tokenRgb("surface")).toEqual([240, 248, 255]);
    expect(parseCssColor("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
    expect(tokenRgb("nonexistent")).toEqual([128, 128, 128]);
  });

  it("outlines a pending stop warn, an accepted one good, others muted, a stay-less one the track's", () => {
    const warn: [number, number, number] = [1, 0, 0];
    const good: [number, number, number] = [2, 0, 0];
    const muted: [number, number, number] = [3, 0, 0];
    const outline = stopOutlineOf({ warn, good, muted });
    expect(outline("pending")).toBe(warn);
    expect(outline("accepted")).toBe(good);
    expect(outline("rejected")).toBe(muted);
    expect(outline(null)).not.toBe(warn);
  });
});
