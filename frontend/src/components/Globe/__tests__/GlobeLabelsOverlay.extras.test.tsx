import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { GlobeLabelsOverlay } from "../GlobeLabelsOverlay";
import type { GlobeExtraLabel } from "../globePinLabels";
import type { PointDatum } from "../globeLayerTypes";

/**
 * A hotel or place name has exactly one route onto the sphere: this overlay.
 * deck.gl 9's billboard TextLayer does not render under MapLibre's globe
 * projection in interleaved mode — the same layer renders fine on the flat
 * mercator map — which is why the flat map's label layers have no globe
 * counterpart and why an untested overlay would mean untested labels.
 *
 * jsdom cannot judge WHERE a pill lands (map.project is stubbed, and nothing
 * paints). What it can judge is that the pill exists, carries its domain's
 * colour, and obeys the "Beschriftungen: Aus" setting — which is what these
 * cases hold.
 */

function fakeMapRef(): React.RefObject<MapRef | null> {
  const ref = createRef<MapRef>() as React.RefObject<MapRef | null>;
  const map = {
    getCenter: () => ({ lng: 8, lat: 50 }),
    getZoom: () => 3,
    project: () => ({ x: 100, y: 100 }),
    on: vi.fn(),
    off: vi.fn(),
  };
  ref.current = { getMap: () => map } as unknown as MapRef;
  return ref;
}

const AIRPORT: PointDatum = {
  position: [8, 50],
  size: 9,
  iata: "FRA",
  name: "Frankfurt",
};

const EXTRAS: GlobeExtraLabel[] = [
  {
    kind: "lodging",
    id: "l1",
    text: "Hotel Kramer",
    lng: 8.6,
    lat: 50.1,
    weight: 4,
    color: "rgb(212, 119, 143)",
  },
  {
    kind: "place",
    id: "p1",
    text: "🌳",
    lng: 8.65,
    lat: 50.12,
    weight: 2,
    color: "rgb(94, 194, 178)",
  },
];

describe("GlobeLabelsOverlay: lodging and place pills", () => {
  it("renders a pill for every pin, beside the airport and port labels", () => {
    render(
      <GlobeLabelsOverlay
        mapRef={fakeMapRef()}
        mapReady
        airports={[AIRPORT]}
        ports={[]}
        extras={EXTRAS}
        mode="important"
      />
    );
    expect(screen.getByText("FRA")).toBeTruthy();
    expect(screen.getByText("Hotel Kramer")).toBeTruthy();
    // A list SYMBOL, which only a DOM pill can render in colour — deck.gl's
    // canvas-built font atlas turns an emoji into an opaque black box
    // (measured; see placePinsLayer.ts).
    expect(screen.getByText("🌳")).toBeTruthy();
  });

  it("paints each pill in its own domain's colour rather than one label colour", () => {
    render(
      <GlobeLabelsOverlay
        mapRef={fakeMapRef()}
        mapReady
        airports={[]}
        ports={[]}
        extras={EXTRAS}
        mode="all"
      />
    );
    expect(screen.getByText("Hotel Kramer").getAttribute("style")).toContain("rgb(212, 119, 143)");
    expect(screen.getByText("🌳").getAttribute("style")).toContain("rgb(94, 194, 178)");
  });

  it('honours "Beschriftungen: Aus" for pins exactly as it does for airports', () => {
    const { container } = render(
      <GlobeLabelsOverlay
        mapRef={fakeMapRef()}
        mapReady
        airports={[AIRPORT]}
        ports={[]}
        extras={EXTRAS}
        mode="off"
      />
    );
    expect(container.textContent).toBe("");
  });
});
