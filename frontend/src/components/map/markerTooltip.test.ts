import { describe, it, expect } from "vitest";
import type { PickingInfo } from "@deck.gl/core";
import { createMarkerTooltip } from "./markerTooltip";

const t = (key: string, opts?: Record<string, unknown>): string => {
  if (key === "map:globe.flight") return (opts?.count as number) === 1 ? "Flug" : "Flüge";
  if (key === "map:tooltip.lastVisit") return "Letzter Besuch";
  if (key === "map:airportMarkers.visits") return "Besuche";
  if (key === "map:tooltip.lastCall") return "Letzter Anlauf";
  if (key === "map:globe.timesFlown") return `${opts?.count}× geflogen`;
  return key;
};

function makeInfo(layerId: string, object: unknown): PickingInfo {
  return { layer: { id: layerId }, object } as unknown as PickingInfo;
}

describe("createMarkerTooltip — airports", () => {
  const getTooltip = createMarkerTooltip(t, "de");

  it("includes a flag image, ICAO pill, and place line when data is present", () => {
    const result = getTooltip(
      makeInfo("routes-dot", {
        iata: "MUC",
        icao: "EDDM",
        name: "Munich Airport",
        country: "DE",
        city: "Munich",
        count: 115,
        lastVisit: "2026-10-19",
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("flagcdn.com/de.svg");
    expect(result!.html).toContain("EDDM");
    expect(result!.html).toContain("Munich, Deutschland");
    expect(result!.html).toContain("115");
  });

  it("degrades gracefully when country/icao/city are absent", () => {
    const result = getTooltip(
      makeInfo("routes-labels", {
        iata: "XYZ",
        name: "Test Field",
        count: 3,
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).not.toContain("flagcdn.com");
    expect(result!.html).not.toContain("undefined");
    expect(result!.html).not.toContain("null");
  });

  it("returns null for an unrelated layer id", () => {
    expect(getTooltip(makeInfo("some-other-layer", {}))).toBeNull();
  });
});
