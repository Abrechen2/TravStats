import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";
import type { Layer } from "@deck.gl/core";

/**
 * forgejo#320, owner UAT: on the overview map station names were printed over
 * airport codes and hotel names. This mounts the REAL `DeckGLMap` with a hotel
 * and a station label layer in `extraLayers`, and proves the station layer it
 * draws carries the hotel's label as an obstacle — so its collision pass sees
 * the map's own labels.
 *
 * Deliberate-break protocol: hand `extraLayers` through untouched again and
 * this test fails.
 */

const { drawn } = vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  return { drawn: [] as Layer[][] };
});

vi.mock("react-map-gl/maplibre", () => {
  const fakeMap = {
    on: vi.fn(),
    off: vi.fn(),
    getZoom: vi.fn(() => 2),
    project: vi.fn(([lon, lat]: [number, number]) => ({ x: lon, y: lat })),
    flyTo: vi.fn(),
    getCanvas: vi.fn(() => ({ style: {} })),
    getContainer: vi.fn(() => document.createElement("div")),
  };
  const MockMapGL = React.forwardRef(function MockMapGL(
    props: { children?: React.ReactNode; onLoad?: () => void },
    ref: React.Ref<unknown>
  ) {
    React.useImperativeHandle(ref, () => ({ getMap: () => fakeMap }), []);
    const { onLoad } = props;
    React.useEffect(() => onLoad?.(), [onLoad]);
    return React.createElement("div", { "data-testid": "fake-maplibre-map" }, props.children);
  });
  function useControl<T>(factory: () => T): T {
    const ref = React.useRef<T | null>(null);
    if (ref.current === null) ref.current = factory();
    return ref.current;
  }
  return { __esModule: true, default: MockMapGL, useControl, useMap: () => ({ current: null }) };
});

vi.mock("@deck.gl/mapbox", () => ({
  MapboxOverlay: class {
    setProps(): void {}
  },
}));

vi.mock("../map/FlatMapControlPanel", () => ({ FlatMapControlPanel: () => null }));
vi.mock("../TimeSlider", () => ({ TimeSlider: () => null }));
vi.mock("../NativeRoutesLayer", () => ({
  NativeRoutesLayer: () => null,
  NATIVE_ROUTE_LINE_ID: "native-route-line",
  NATIVE_AIRPORT_CIRCLE_ID: "native-airport-circle",
}));
vi.mock("../Globe/mapOverlays", () => ({ applyMapOverlays: vi.fn() }));

vi.mock("../map/DeckGLOverlay", () => ({
  webgl2Available: true,
  DeckGLOverlay: ({ layers }: { layers: Layer[] }) => {
    drawn.push(layers);
    return null;
  },
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

import { DeckGLMap } from "../DeckGLMap";
import { StationLabelsLayer, buildStationLabels } from "../layers/stationLabelsLayer";
import type { Lodging } from "../../types/lodging";

beforeEach(() => {
  drawn.length = 0;
  window.localStorage.clear();
});

describe("the flat map's station names see its other labels", () => {
  it("hands the hotel label to the station layer as an obstacle", () => {
    const hotel = {
      id: "l1",
      name: "Hotel Adlon",
      lat: 52.516,
      lon: 13.38,
      stayCount: 3,
      nights: 6,
      type: "hotel",
      city: "Berlin",
      country: "DE",
    } as unknown as Lodging;
    const stations = new StationLabelsLayer({
      id: "all-station-labels",
      data: buildStationLabels(
        [
          {
            status: "completed",
            depStationName: "Berlin Hbf",
            depLon: 13.369,
            depLat: 52.525,
            arrStationName: "Hamburg Hbf",
            arrLon: 10.007,
            arrLat: 53.553,
          },
        ],
        [1, 2, 3]
      ),
      labelsMode: "important",
    });
    render(
      <DeckGLMap
        flights={[]}
        visMode="routes"
        lodgingsOverride={[hotel]}
        extraLayers={[stations]}
      />
    );
    const last = drawn[drawn.length - 1];
    const station = last.find((l) => l instanceof StationLabelsLayer) as StationLabelsLayer;
    expect(station).toBeDefined();
    expect(station.props.obstacles?.map((o) => o.position)).toContainEqual([13.38, 52.516]);
  });
});
