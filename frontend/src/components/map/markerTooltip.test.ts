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

describe("createMarkerTooltip — ports", () => {
  const getTooltip = createMarkerTooltip(t, "de");

  it("includes a flag and place line when country/city are present", () => {
    const result = getTooltip(
      makeInfo("cruise-ports", {
        name: "Civitavecchia",
        shortLabel: "Civitavecchia",
        country: "IT",
        city: "Civitavecchia",
        visits: 4,
        lastVisit: "2024-05-01",
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("flagcdn.com/it.svg");
    expect(result!.html).toContain("Civitavecchia, Italien");
    expect(result!.html).toContain("4");
  });

  it("falls back to the anchor glyph when country is absent", () => {
    const result = getTooltip(
      makeInfo("cruise-ports-labels", {
        name: "Unnamed Port",
        shortLabel: "Unnamed Port",
        visits: 1,
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).not.toContain("flagcdn.com");
    expect(result!.html).toContain("⚓");
  });
});

describe("createMarkerTooltip — routes", () => {
  const getTooltip = createMarkerTooltip(t, "de");

  it("shows flag + iata + name for both endpoints plus times-flown", () => {
    const result = getTooltip(
      makeInfo("routes-arc", {
        departure: { iata: "MUC", name: "Munich Airport", country: "DE" },
        arrival: { iata: "JFK", name: "New York", country: "US" },
        count: 3,
        sourceColor: [240, 169, 71, 220],
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("flagcdn.com/de.svg");
    expect(result!.html).toContain("flagcdn.com/us.svg");
    expect(result!.html).toContain("MUC");
    expect(result!.html).toContain("JFK");
    expect(result!.html).toContain("3× geflogen");
  });

  it("returns null when the arc datum has no departure/arrival identity", () => {
    expect(getTooltip(makeInfo("routes-arc-scheduled", { count: 1 }))).toBeNull();
  });
});
