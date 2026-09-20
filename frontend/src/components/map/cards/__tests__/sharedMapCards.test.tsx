import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createRef, type ReactElement } from "react";

import { PinnedCard } from "../PinnedCard";
import { HoverTooltip, type HoverTooltipApi } from "../HoverTooltip";
import type { MapPinned } from "../pinnedTypes";
import { airportHoverHtml, arcHoverHtml, portHoverHtml } from "../hoverCardHtml";
import type { GeoJSONFeature } from "../../../../types";

/**
 * The owner ruled on 2026-09-20, with two screenshots side by side, that the
 * globe's click card is THE map card and the flat map's five ad-hoc tooltips
 * go. That only works if the card is map chrome rather than globe chrome, so
 * this file pins the part the ruling actually rests on: the card and the hover
 * tooltip live under `components/Map/cards/`, and they render from plain data
 * plus an anchor — no globe import, no `GlobeView` state, no MapLibre.
 */

function feature(id: string, overrides: Record<string, unknown> = {}): GeoJSONFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [] },
    properties: {
      id,
      departureAirport: { iata: "TOS", name: "Tromsø", country: "NO", city: "Tromsø" },
      arrivalAirport: { iata: "AGP", name: "Málaga", country: "ES", city: "Málaga" },
      airline: "Delta Air Lines",
      flightNumber: "DL6287",
      aircraft: "B767-400ER",
      departureTime: "2021-06-05T08:00:00Z",
      distance: 3931,
      status: "flown",
      ...overrides,
    },
  } as unknown as GeoJSONFeature;
}

/**
 * The card lifts itself in on mount via `requestAnimationFrame`, so a bare
 * `render` settles one frame AFTER the assertions — which is an act warning,
 * not a flake. Flushing the frame inside act is the honest wait.
 */
async function renderCard(ui: ReactElement): Promise<void> {
  render(ui);
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

const routePinned: MapPinned = {
  kind: "arc",
  anchorLngLat: [10, 50],
  data: {
    departure: { iata: "TOS", name: "Tromsø", country: "NO", city: "Tromsø" },
    arrival: { iata: "AGP", name: "Málaga", country: "ES", city: "Málaga" },
    flightIds: ["f1"],
    count: 1,
    color: [240, 169, 71],
  },
};

describe("the shared map cards", () => {
  it("renders the route card from data + anchor alone", async () => {
    await renderCard(
      <PinnedCard
        pinned={routePinned}
        flights={[feature("f1")]}
        cruises={[]}
        onClose={vi.fn()}
        onFlightOpen={vi.fn()}
      />
    );

    expect(screen.getByText("TOS")).toBeInTheDocument();
    expect(screen.getByText("AGP")).toBeInTheDocument();
    // The list the ruling names: airline, number, date. The airline also
    // appears as the route's "Top Linie", hence getAllByText.
    expect(screen.getAllByText("Delta Air Lines").length).toBeGreaterThan(0);
    expect(screen.getByText("DL6287")).toBeInTheDocument();
  });

  it("offers the edit action beside the open action, so both maps share one action row", async () => {
    const onFlightEdit = vi.fn();
    await renderCard(
      <PinnedCard
        pinned={routePinned}
        flights={[feature("f1")]}
        cruises={[]}
        onClose={vi.fn()}
        onFlightOpen={vi.fn()}
        onFlightEdit={onFlightEdit}
      />
    );

    expect(screen.getByRole("button", { name: "common:buttons.edit" })).toBeInTheDocument();
  });

  // The suite renders raw i18n keys (no resources are loaded), so the
  // assertion names the KEY. The German and English copy behind it is what
  // `i18n/__tests__/localeKeyParity.test.ts` holds.
  it("names the single flight rather than the last one when the selection is one flight", async () => {
    await renderCard(
      <PinnedCard
        pinned={routePinned}
        flights={[feature("f1")]}
        cruises={[]}
        onClose={vi.fn()}
        onFlightOpen={vi.fn()}
        selectionScope="single"
      />
    );

    expect(screen.getByRole("button", { name: "map:globe.pinned.openFlight" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "map:globe.openLastFlight" })).toBeNull();
  });

  it("names the LAST flight when the selection is the whole route", async () => {
    await renderCard(
      <PinnedCard
        pinned={routePinned}
        flights={[feature("f1")]}
        cruises={[]}
        onClose={vi.fn()}
        onFlightOpen={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "map:globe.openLastFlight" })).toBeInTheDocument();
  });

  it("shows and hides the hover tooltip through its imperative handle", () => {
    const ref = createRef<HoverTooltipApi>();
    render(<HoverTooltip ref={ref} />);
    expect(document.body.textContent).toBe("");

    act(() => ref.current?.show({ html: "<b>OSL</b>", x: 10, y: 20 }));
    expect(document.querySelector("b")?.textContent).toBe("OSL");

    act(() => ref.current?.hide());
    expect(document.querySelector("b")).toBeNull();
  });
});

describe("the shared hover html", () => {
  const t = (key: string, opts?: Record<string, unknown>): string =>
    opts && "count" in opts ? `${key}:${String(opts.count)}` : key;

  it("builds an airport tooltip with the ICAO pill and the place line", () => {
    const html = airportHoverHtml(
      { iata: "OSL", icao: "ENGM", name: "Gardermoen", city: "Oslo", country: "NO", count: 4 },
      { t, locale: "de", flagHeight: 19 }
    );
    expect(html).toContain("OSL");
    expect(html).toContain("ENGM");
    expect(html).toContain("Gardermoen");
  });

  it("omits the port visit line when the caller reports no visits", () => {
    const withVisits = portHoverHtml(
      { name: "Kiel", country: "DE", visits: 3 },
      { t, locale: "de", flagHeight: 19 }
    );
    const without = portHoverHtml({ name: "Kiel", country: "DE" }, { t, locale: "de" });
    expect(withVisits).toContain("map:airportMarkers.visits");
    expect(without).not.toContain("map:airportMarkers.visits");
  });

  it("names flown and planned separately on a route", () => {
    const html = arcHoverHtml(
      {
        departure: { iata: "TOS", name: "Tromsø", country: "NO" },
        arrival: { iata: "AGP", name: "Málaga", country: "ES" },
        count: 3,
        color: [240, 169, 71],
        flownCount: 2,
        scheduledCount: 1,
      },
      { t, flagHeight: 18 }
    );
    expect(html).toContain("map:globe.timesFlown:2");
    expect(html).toContain("map:globe.timesPlanned:1");
  });
});
