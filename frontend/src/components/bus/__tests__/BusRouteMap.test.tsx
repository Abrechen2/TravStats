import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { JSX, ReactNode } from "react";
import { rideFixture } from "./busFixture";
import type { BusJourney } from "../../../types/bus";

// The real German copy, so the test reads what the reader sees.
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

/** The layers each overlay was last handed, so a test can read what the map draws. */
const overlayLayers = vi.hoisted(() => ({ value: [] as unknown[] }));
const initialView = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("react-map-gl/maplibre", () => {
  const MapStub = ({
    children,
    onLoad,
    initialViewState,
  }: {
    children?: ReactNode;
    onLoad?: () => void;
    initialViewState?: unknown;
  }): JSX.Element => {
    initialView.value = initialViewState;
    return (
      <div data-testid="map-instance" onClick={onLoad}>
        {children}
      </div>
    );
  };
  return {
    default: MapStub,
    useMap: () => ({}),
    useControl: (factory: () => unknown) => factory(),
  };
});
vi.mock("@deck.gl/mapbox", () => ({
  MapboxOverlay: class {
    setProps({ layers }: { layers: unknown[] }): void {
      overlayLayers.value = layers;
    }
  },
}));
vi.mock("../../map/SharedMapOverlays", () => ({ SharedMapOverlays: () => null }));
vi.mock("../../map/useBasemapStyle", () => ({ useBasemapStyle: () => "style.json" }));
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colorOf: () => "#c49a6c" }),
}));

import { BusRouteMap, busLineCaptionKey } from "../BusRouteMap";

interface PathProps {
  pickable: boolean;
  data: { path: [number, number][]; routed: boolean }[];
}

async function renderLoaded(ride: BusJourney): Promise<PathProps> {
  render(<BusRouteMap ride={ride} />);
  // The overlay mounts once the map reports "loaded".
  await act(async () => {
    screen.getByTestId("map-instance").click();
  });
  const paths = overlayLayers.value.find((l) => (l as { id: string }).id === "bus-detail-paths");
  return (paths as { props: PathProps }).props;
}

const ROAD: [number, number][] = [
  [127.0046, 37.5048],
  [127.9, 37.9],
  [128.5918, 38.1911],
];

describe("BusRouteMap", () => {
  beforeEach(() => {
    overlayLayers.value = [];
    initialView.value = null;
  });

  it("draws the stored road line, as the dashboard does, and says it was routed", async () => {
    const props = await renderLoaded({ ...rideFixture(), geometry: ROAD, geometrySource: "road" });
    expect(props.data).toHaveLength(1);
    expect(props.data[0]).toMatchObject({ path: ROAD, routed: true });
    // A detail map has no card to open: nothing answers a hover or a click.
    expect(props.pickable).toBe(false);
    expect(screen.getByTestId("bus-line-source")).toHaveTextContent(
      "Linie: über das Straßennetz berechnet und gespeichert"
    );
  });

  it("falls back to the chord between the terminals and calls it Luftlinie", async () => {
    const props = await renderLoaded(rideFixture());
    expect(props.data[0]).toMatchObject({
      path: [
        [127.0046, 37.5048],
        [128.5918, 38.1911],
      ],
      routed: false,
    });
    expect(screen.getByTestId("bus-line-source")).toHaveTextContent(
      "Linie: Luftlinie zwischen den Terminals — nicht der Weg des Busses."
    );
  });

  it("frames the map around the ride", () => {
    render(<BusRouteMap ride={{ ...rideFixture(), geometry: ROAD, geometrySource: "road" }} />);
    const { bounds } = initialView.value as { bounds: [[number, number], [number, number]] };
    expect(bounds[0][0]).toBeLessThan(127.0046);
    expect(bounds[1][1]).toBeGreaterThan(38.1911);
  });

  it("still draws a cancelled ride on its own page", async () => {
    const props = await renderLoaded({ ...rideFixture(), status: "cancelled" });
    expect(props.data).toHaveLength(1);
  });

  it("names what is drawn, not what the row claims", () => {
    expect(busLineCaptionKey({ geometry: null, geometrySource: "road" })).toBe(
      "bus:detail.lineStraight"
    );
    expect(busLineCaptionKey({ geometry: ROAD, geometrySource: "manual" })).toBe(
      "bus:detail.lineManual"
    );
    expect(busLineCaptionKey({ geometry: ROAD, geometrySource: "road" })).toBe(
      "bus:detail.lineRoad"
    );
  });
});
