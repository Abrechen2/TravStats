import { describe, it, expect } from "vitest";
import type { PickingInfo } from "@deck.gl/core";
import { createMarkerTooltip } from "./markerTooltip";

const t = (key: string, opts?: Record<string, unknown>): string => {
  if (key === "map:globe.flight") return (opts?.count as number) === 1 ? "Flug" : "Flüge";
  if (key === "map:tooltip.lastVisit") return "Letzter Besuch";
  if (key === "map:airportMarkers.visits") return "Besuche";
  if (key === "map:tooltip.lastCall") return "Letzter Anlauf";
  if (key === "map:globe.timesFlown") return `${opts?.count}× geflogen`;
  if (key === "map:globe.timesPlanned") return `${opts?.count}× geplant`;
  if (key === "lodging:field.staysCount") return `${opts?.count} Aufenthalte`;
  if (key === "lodging:field.nightsCount") return `${opts?.count} Übernachtungen`;
  if (key === "places:list.visitsCount") return `${opts?.count} Besuche`;
  if (key === "places:list.status.wishlist") return "Merkliste";
  if (key === "places:categories.restaurant") return "Restaurant";
  if (key === "places:categories.landmark") return "Sehenswürdigkeit";
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

  it("labels a pure-scheduled route as planned, not flown", () => {
    const result = getTooltip(
      makeInfo("routes-arc-scheduled", {
        departure: { iata: "MUC", name: "Munich Airport", country: "DE" },
        arrival: { iata: "JFK", name: "New York", country: "US" },
        count: 1,
        flownCount: 0,
        scheduledCount: 1,
        sourceColor: [240, 169, 71, 220],
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("1× geplant");
    expect(result!.html).not.toContain("geflogen");
  });

  it("labels a mixed route with both counts", () => {
    const result = getTooltip(
      makeInfo("routes-arc", {
        departure: { iata: "MUC", name: "Munich Airport", country: "DE" },
        arrival: { iata: "JFK", name: "New York", country: "US" },
        count: 4,
        flownCount: 3,
        scheduledCount: 1,
        sourceColor: [240, 169, 71, 220],
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("3× geflogen · 1× geplant");
  });

  it("falls back to the legacy flown label for a cancelled-only route", () => {
    const result = getTooltip(
      makeInfo("routes-arc", {
        departure: { iata: "MUC", name: "Munich Airport", country: "DE" },
        arrival: { iata: "JFK", name: "New York", country: "US" },
        count: 2,
        flownCount: 0,
        scheduledCount: 0,
        sourceColor: [240, 169, 71, 220],
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("2× geflogen");
    expect(result!.html).not.toContain("geplant");
  });

  it("keeps the plain flown label for legacy datums without counts", () => {
    const result = getTooltip(
      makeInfo("routes-arc", {
        departure: { iata: "MUC", name: "Munich Airport", country: "DE" },
        arrival: { iata: "JFK", name: "New York", country: "US" },
        count: 3,
        sourceColor: [240, 169, 71, 220],
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("3× geflogen");
  });
});

describe("createMarkerTooltip — cruise path", () => {
  const getTooltip = createMarkerTooltip(t, "de");

  it("shows the cruise line for a cruise-arcs hover", () => {
    const result = getTooltip(makeInfo("cruise-arcs", { cruiseLine: "AIDA Cruises" }));
    expect(result).not.toBeNull();
    expect(result!.html).toContain("AIDA Cruises");
  });

  it("falls back to a generic label when cruiseLine is null", () => {
    const result = getTooltip(makeInfo("cruise-arcs", { cruiseLine: null }));
    expect(result).not.toBeNull();
    expect(result!.html).toContain("Cruise");
  });
});

describe("createMarkerTooltip — lodging", () => {
  const getTooltip = createMarkerTooltip(t, "de");

  it("resolves a free-text country name to a flag, and shows the place line + stay/night counts", () => {
    // Lodging.country is free text (a full name OR an ISO code — see
    // resolveCountryCode in lib/countryFlag.tsx), unlike the airport/port
    // datums which already carry a strict ISO code. "Deutschland" must
    // still resolve to the DE flag.
    const result = getTooltip(
      makeInfo("lodging-pins", {
        name: "Hotel Adlon Kempinski",
        city: "Berlin",
        country: "Deutschland",
        stayCount: 3,
        nights: 7,
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("flagcdn.com/de.svg");
    expect(result!.html).toContain("Hotel Adlon Kempinski");
    expect(result!.html).toContain("Berlin, Deutschland");
    expect(result!.html).toContain("3 Aufenthalte");
    expect(result!.html).toContain("7 Übernachtungen");
  });

  it("also resolves an already-valid ISO country code (not just a free-text name)", () => {
    const result = getTooltip(
      makeInfo("lodging-pins-labels", {
        name: "Le Meurice",
        city: "Paris",
        country: "FR",
        stayCount: 1,
        nights: 2,
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("flagcdn.com/fr.svg");
  });

  it("degrades gracefully when city/country/counts are absent", () => {
    const result = getTooltip(makeInfo("lodging-pins", { name: "Unnamed Guesthouse" }));
    expect(result).not.toBeNull();
    expect(result!.html).not.toContain("flagcdn.com");
    expect(result!.html).not.toContain("undefined");
    expect(result!.html).not.toContain("null");
    expect(result!.html).toContain("Unnamed Guesthouse");
  });

  it("returns null when the lodging datum has no name", () => {
    expect(getTooltip(makeInfo("lodging-pins", { city: "Berlin" }))).toBeNull();
  });

  it("returns null for an unrelated layer id", () => {
    expect(getTooltip(makeInfo("some-other-layer", { name: "x" }))).toBeNull();
  });
});

/**
 * Places were the one domain whose pins were pickable and answered nothing.
 *
 * Every other domain — airports, ports, arcs, cruise paths, lodging — has a
 * branch here. The place pin datum was even built to feed one ("Completed
 * visits — feeds the tooltip", placePinsLayer.ts), but no branch existed, so
 * hovering a place gave the hand cursor and no card (Alex, 2026-08-29).
 */
describe("createMarkerTooltip — places", () => {
  const getTooltip = createMarkerTooltip(t, "de");

  it("answers for a place pin, with its country, category and visits", () => {
    const result = getTooltip(
      makeInfo("place-pins", {
        name: "McDonald's Trevi",
        category: "restaurant",
        city: "Rom",
        country: "Italien",
        visitCount: 3,
        visited: true,
      })
    );

    expect(result).not.toBeNull();
    expect(result!.html).toContain("flagcdn.com/it.svg");
    expect(result!.html).toContain("McDonald&#039;s Trevi");
    expect(result!.html).toContain("Rom, Italien");
    expect(result!.html).toContain("Restaurant");
    expect(result!.html).toContain("3 Besuche");
  });

  it("answers on the label layers too, not only the dots", () => {
    for (const layer of ["place-pins-labels", "place-pins-symbols"]) {
      const result = getTooltip(
        makeInfo(layer, { name: "Kolosseum", category: "landmark", visited: true })
      );
      expect(result, layer).not.toBeNull();
      expect(result!.html).toContain("Kolosseum");
    }
  });

  it("says wishlist rather than counting a visit that has not happened", () => {
    const result = getTooltip(
      makeInfo("place-pins", {
        name: "Sagrada Família",
        category: "landmark",
        city: "Barcelona",
        country: "ES",
        visitCount: 0,
        visited: false,
      })
    );

    expect(result!.html).toContain("Merkliste");
    expect(result!.html).not.toContain("0 Besuche");
  });

  it("stays silent for a datum with no name", () => {
    expect(getTooltip(makeInfo("place-pins", { category: "other" }))).toBeNull();
  });
});
