import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import * as React from "react";
import type { Layer } from "@deck.gl/core";

/**
 * forgejo#348: in trips mode the slider moves `currentTime` every frame. Only
 * the trips layers depend on it, so the cruise ports, pins and the label pass
 * must not be rebuilt per frame.
 *
 * Deliberate-break protocol: put `currentTime` back into the single layers
 * memo and the port layer below is a new instance on every tick.
 */

const { drawn, slider } = vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  return { drawn: [] as Layer[][], slider: { onChange: (_v: number): void => {} } };
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
vi.mock("../TimeSlider", () => ({
  TimeSlider: (props: { onChange: (v: number) => void }) => {
    slider.onChange = props.onChange;
    return null;
  },
}));
vi.mock("../NativeRoutesLayer", () => ({
  NativeRoutesLayer: () => null,
  NATIVE_ROUTE_LINE_ID: "native-route-line",
  NATIVE_AIRPORT_CIRCLE_ID: "native-airport-circle",
}));
const emptyGeometry = vi.hoisted(() => new Map());
vi.mock("../../hooks/useCruiseGeometry", () => ({ useCruiseGeometry: () => emptyGeometry }));
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
import type { Cruise } from "../../types/cruise";
import type { GeoJSONFeature } from "../../types";

beforeEach(() => {
  drawn.length = 0;
  window.localStorage.clear();
});

const flight = {
  type: "Feature",
  properties: {
    id: "f1",
    status: "flown",
    departureTime: "2024-05-01T08:00:00Z",
    arrivalTime: "2024-05-01T19:00:00Z",
    departureAirport: { iata: "FRA", name: "Frankfurt", lat: 50.03, lon: 8.57 },
    arrivalAirport: { iata: "JFK", name: "New York", lat: 40.64, lon: -73.78 },
  },
  geometry: {
    type: "LineString",
    coordinates: [
      [8.57, 50.03],
      [-73.78, 40.64],
    ],
  },
} as unknown as GeoJSONFeature;

const cruise = {
  id: "c1",
  status: "completed",
  departurePort: { id: "p1", name: "Hamburg", lat: 53.5, lon: 9.9, country: "DE" },
  arrivalPort: { id: "p2", name: "Kiel", lat: 54.3, lon: 10.1, country: "DE" },
  stops: [],
} as unknown as Cruise;

describe("trips mode animation (forgejo#348)", () => {
  it("rebuilds only the trips layers when the slider time moves", () => {
    render(<DeckGLMap flights={[flight]} visMode="trips" cruises={[cruise]} />);
    const before = drawn[drawn.length - 1];
    const idsBefore = before.map((l) => l.id);
    expect(idsBefore).toContain("trips");
    act(() => slider.onChange(1_714_550_000));
    const after = drawn[drawn.length - 1];
    expect(after.map((l) => l.id)).toEqual(idsBefore);
    const statics = before.filter((l) => !/trip|plane/i.test(l.id));
    expect(statics.length).toBeGreaterThan(0);
    for (const layer of statics) {
      expect(
        after.find((l) => l.id === layer.id),
        `${layer.id} was rebuilt`
      ).toBe(layer);
    }
    const trips = before.find((l) => l.id === "trips");
    expect(after.find((l) => l.id === "trips")).not.toBe(trips);
  });
});
