import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import * as React from "react";

/**
 * "Wenn ich im Aktivitäts-Sidepanel einen Eintrag auswähle, soll der in der
 * Karte gezeigt werden mit Details, so wie bei den Flügen — beim Globus und
 * der 2D-Karte." (owner, 2026-09-20)
 *
 * Measured before the change: the sidebar wrote all four selection stores, the
 * flat map read two of them, and the globe read none. Selecting a hotel or a
 * place moved nothing and showed nothing on either surface; selecting a flight
 * or a cruise did nothing on the globe.
 *
 * So this file asserts the SAME four things against BOTH renderers: the card
 * that opens is the shared one, it carries the selection's own fields, and the
 * camera is asked to go there. The fifth case is the one that must NOT happen
 * — a lodging whose location never resolved has no pin to focus, so it opens
 * no card and moves no camera.
 *
 * Deliberate-break protocol: delete any of the four selection effects in
 * DeckGLMap.tsx or GlobeView.tsx — this file fails.
 */

const { cardProps, flyTo, camera } = vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  // The camera MOVES. On a globe the card is only drawn once its anchor is on
  // the near hemisphere, so a `flyTo` that leaves `getCenter` at [0,0] would
  // measure the wrong thing: a Berlin hotel is past the horizon from a camera
  // over [0,0] at zoom 2, and the card would correctly not be drawn.
  const camera = { lng: 0, lat: 0 };
  const flyTo = vi.fn((opts: { center?: [number, number] }) => {
    if (opts?.center) {
      camera.lng = opts.center[0];
      camera.lat = opts.center[1];
    }
  });
  return { cardProps: [] as Array<Record<string, unknown>>, flyTo, camera };
});

vi.mock("react-map-gl/maplibre", () => {
  const fakeMap = {
    on: vi.fn(),
    off: vi.fn(),
    getZoom: vi.fn(() => 2),
    getBearing: vi.fn(() => 0),
    getCenter: vi.fn(() => ({ lng: camera.lng, lat: camera.lat })),
    getPitch: vi.fn(() => 0),
    project: vi.fn(([lon, lat]: [number, number]) => ({ x: lon, y: lat })),
    unproject: vi.fn(() => ({ lng: 0, lat: 0 })),
    flyTo,
    jumpTo: vi.fn(),
    setProjection: vi.fn(),
    setSky: vi.fn(),
    getCanvas: vi.fn(() => ({ style: {} })),
    getContainer: vi.fn(() => document.createElement("div")),
  };
  const MockMapGL = React.forwardRef(function MockMapGL(
    props: { onLoad?: () => void; children?: React.ReactNode },
    ref: React.Ref<unknown>
  ) {
    React.useImperativeHandle(ref, () => ({ getMap: () => fakeMap }), []);
    React.useEffect(() => props.onLoad?.(), []);
    return React.createElement("div", { "data-testid": "fake-map" }, props.children);
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
vi.mock("../Globe/GlobeControlPanel", () => ({ GlobeControlPanel: () => null }));
vi.mock("../Globe/GlobeTimeHistogram", () => ({ GlobeTimeHistogram: () => null }));
vi.mock("../Globe/GlobeLabelsOverlay", () => ({ GlobeLabelsOverlay: () => null }));
vi.mock("../TimeSlider", () => ({ TimeSlider: () => null }));
vi.mock("../NativeRoutesLayer", () => ({
  NativeRoutesLayer: () => null,
  NATIVE_ROUTE_LINE_ID: "native-route-line",
  NATIVE_AIRPORT_CIRCLE_ID: "native-airport-circle",
}));
vi.mock("../Globe/mapOverlays", () => ({ applyMapOverlays: vi.fn() }));
vi.mock("../map/cards/HoverTooltip", () => ({ HoverTooltip: () => null }));

vi.mock("../map/cards/PinnedCard", () => ({
  PinnedCard: (props: Record<string, unknown>) => {
    cardProps.push(props);
    return React.createElement("div", { "data-testid": "shared-pinned-card" });
  },
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

vi.mock("../../lib/api/cruise", () => ({
  cruiseApi: { getGeometryBatch: vi.fn().mockResolvedValue(new Map()) },
}));

import { DeckGLMap } from "../DeckGLMap";
import GlobeView from "../GlobeView";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import { useCruiseSelectionStore } from "../../store/cruiseSelectionStore";
import { useLodgingSelectionStore } from "../../store/lodgingSelectionStore";
import { usePlaceSelectionStore } from "../../store/placeSelectionStore";
import { useMapCameraStore } from "../../store/mapCameraStore";
import type { Flight, GeoJSONFeature } from "../../types";
import type { Cruise } from "../../types/cruise";
import type { Lodging } from "../../types/lodging";
import type { Place } from "../../types/place";

const GEO: GeoJSONFeature[] = [
  {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [10, 50],
        [20, 40],
      ],
    },
    properties: {
      id: "f1",
      airline: "Delta Air Lines",
      flightNumber: "DL6287",
      departureAirport: { iata: "TOS", name: "Tromsø", country: "NO" },
      arrivalAirport: { iata: "AGP", name: "Málaga", country: "ES" },
      departureTime: "2021-06-05T08:00:00Z",
      arrivalTime: "2021-06-05T12:00:00Z",
      status: "flown",
      distance: 3931,
    },
  } as unknown as GeoJSONFeature,
];

const FLIGHT = {
  id: "f1",
  airline: "Delta Air Lines",
  flightNumber: "DL6287",
  depIata: "TOS",
  depName: "Tromsø",
  arrIata: "AGP",
  arrName: "Málaga",
  depLon: 10,
  depLat: 50,
  arrLon: 20,
  arrLat: 40,
  departureTime: "2021-06-05T08:00:00Z",
  arrivalTime: "2021-06-05T12:00:00Z",
  status: "flown",
  routeDistance: 3931,
} as unknown as Flight;

const CRUISE = {
  id: "c1",
  stops: [],
  ship: { name: "AIDAnova" },
  departurePort: { lon: 12, lat: 42 },
  arrivalPort: { lon: 12, lat: 42 },
} as unknown as Cruise;

function lodging(overrides: Partial<Lodging> = {}): Lodging {
  return {
    id: "l1",
    name: "Hilton Berlin",
    city: "Berlin",
    country: "Deutschland",
    isoCountryCode: "DE",
    nights: 3,
    stayCount: 1,
    lat: 52.5,
    lon: 13.4,
    stays: [
      {
        id: "s1",
        checkIn: "2024-05-01",
        checkOut: "2024-05-04",
        datePrecision: "DAY",
        nights: null,
        totalPrice: 420,
        currency: "EUR",
      },
    ],
    ...overrides,
  } as unknown as Lodging;
}

const PLACE = {
  id: "p1",
  name: "Kolosseum",
  category: "sight",
  lat: 41.89,
  lon: 12.49,
  city: "Rom",
  isoCountryCode: "IT",
  visited: true,
  visitCount: 2,
  lastVisitAt: "2023-09-10",
} as unknown as Place;

function clearSelections(): void {
  useFlightSelectionStore.getState().clearSelection();
  useCruiseSelectionStore.getState().clearSelection();
  useLodgingSelectionStore.getState().clearSelection();
  usePlaceSelectionStore.getState().clearSelection();
}

beforeEach(() => {
  cardProps.length = 0;
  flyTo.mockClear();
  camera.lng = 0;
  camera.lat = 0;
  clearSelections();
  useMapCameraStore.setState({ camera: {} });
  window.localStorage.clear();
  vi.useFakeTimers();
});

async function settle(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
}

const surfaces: Array<{
  name: string;
  render: () => void;
  /** The "Reise" view: one trip via extraLayers, `flights={[]}`. */
  renderJourney: () => void;
}> = [
  {
    name: "the flat map",
    render: () => {
      render(<DeckGLMap flights={GEO} visMode="routes" cruises={[CRUISE]} />);
    },
    renderJourney: () => {
      render(<DeckGLMap flights={[]} visMode="routes" cruises={[]} />);
    },
  },
  {
    name: "the globe",
    render: () => {
      render(<GlobeView flights={GEO} cruises={[CRUISE]} />);
    },
    renderJourney: () => {
      render(<GlobeView flights={[]} cruises={[]} />);
    },
  },
];

function lastCard(): Record<string, unknown> {
  expect(cardProps.length).toBeGreaterThan(0);
  return cardProps[cardProps.length - 1];
}

for (const surface of surfaces) {
  describe(`${surface.name}: a sidebar selection opens the shared card`, () => {
    it("flight → the route card", async () => {
      surface.render();
      act(() => useFlightSelectionStore.getState().setSelection([FLIGHT]));
      await settle();

      expect((lastCard().pinned as { kind: string }).kind).toBe("arc");
    });

    it("cruise → the cruise card", async () => {
      surface.render();
      act(() => useCruiseSelectionStore.getState().setSelection(CRUISE));
      await settle();

      const pinned = lastCard().pinned as { kind: string; data: { cruiseLabel: string } };
      expect(pinned.kind).toBe("cruise");
      expect(pinned.data.cruiseLabel).toBe("AIDAnova");
    });

    it("lodging → name, place, the stay's dates and nights, and the price", async () => {
      surface.render();
      act(() => useLodgingSelectionStore.getState().setSelection(lodging()));
      await settle();

      const pinned = lastCard().pinned as {
        kind: string;
        data: Record<string, unknown>;
        anchorLngLat: [number, number];
      };
      // The card reads the DOMAIN ROW — `LodgingCardDatum` is a structural
      // subset of `Lodging`, which is what lets the globe's pin click and this
      // selection path hand it the same record without a second shape.
      expect(pinned.kind).toBe("lodging");
      expect(pinned.data.name).toBe("Hilton Berlin");
      expect(pinned.data.city).toBe("Berlin");
      expect(pinned.data.nights).toBe(3);
      expect((pinned.data.stays as Array<{ checkIn: string }>)[0].checkIn).toBe("2024-05-01");
      expect(pinned.anchorLngLat).toEqual([13.4, 52.5]);
      expect(flyTo).toHaveBeenCalled();
    });

    it("place → name, place, visit count and last visit", async () => {
      surface.render();
      act(() => usePlaceSelectionStore.getState().setSelection(PLACE));
      await settle();

      const pinned = lastCard().pinned as { kind: string; data: Record<string, unknown> };
      expect(pinned.kind).toBe("place");
      expect(pinned.data.name).toBe("Kolosseum");
      expect(pinned.data.category).toBe("sight");
      expect(pinned.data.visitCount).toBe(2);
      expect(pinned.data.lastVisitAt).toBe("2023-09-10");
      expect(flyTo).toHaveBeenCalled();
    });

    /**
     * `AllTab`'s journey branch passes `flights={[]}` — it draws one trip
     * through `extraLayers` and nothing of its own. The card read its route,
     * its stats and its list out of that empty array, so a flight row selected
     * in the Reise view produced no card and no camera move, on either
     * surface. The `MapTooltip` this card replaced read the selection store
     * and never touched /geo.
     */
    it("opens the route card in the Reise view, where the /geo set is empty", async () => {
      surface.renderJourney();
      flyTo.mockClear();

      act(() => useFlightSelectionStore.getState().setSelection([FLIGHT]));
      await settle();

      const props = lastCard();
      const pinned = props.pinned as { kind: string; data: { departure: { iata?: string } } };
      expect(pinned.kind).toBe("arc");
      expect(pinned.data.departure.iata).toBe("TOS");
      // …and the card can still look the flight up, so the list and the stats
      // are not empty beside a route that is not.
      expect((props.flights as unknown[]).length).toBe(1);
      expect(flyTo).toHaveBeenCalled();
    });

    it("a lodging with no resolved location opens no card and moves no camera", async () => {
      surface.render();
      flyTo.mockClear();
      cardProps.length = 0;

      act(() =>
        useLodgingSelectionStore.getState().setSelection(lodging({ lat: null, lon: null }))
      );
      await settle();

      expect(cardProps.length).toBe(0);
      expect(flyTo).not.toHaveBeenCalled();
    });
  });
}

/**
 * Two camera commands fought on every flat flight selection: the bounding-box
 * `flyTo` at t=0, which exists so BOTH airports are on screen, and then the
 * card's own `focusMarker` at t=220 ms, which snapped to zoom 6 over the route
 * midpoint and pushed both of them off it. The comment above the bbox effect
 * states the invariant the second call broke.
 *
 * The host frames a flight selection; the hook frames the single markers the
 * host has no framing rule for.
 */
describe("the flat map frames a flight selection exactly once", () => {
  it("issues the bounding-box flyTo and nothing after it", async () => {
    render(<DeckGLMap flights={GEO} visMode="routes" />);
    flyTo.mockClear();

    act(() => useFlightSelectionStore.getState().setSelection([FLIGHT]));
    await settle();

    expect(flyTo).toHaveBeenCalledTimes(1);
    // The bbox zoom for a 10° span, not the single-marker floor of 6.
    expect(flyTo.mock.calls[0][0]).toMatchObject({ zoom: 4 });
  });

  it("still frames a hotel, which the host has no bounding box for", async () => {
    render(<DeckGLMap flights={GEO} visMode="routes" />);
    flyTo.mockClear();

    act(() => useLodgingSelectionStore.getState().setSelection(lodging()));
    await settle();

    expect(flyTo).toHaveBeenCalledTimes(1);
    expect(flyTo.mock.calls[0][0]).toMatchObject({ center: [13.4, 52.5] });
  });
});

describe("the globe frames a flight selection itself", () => {
  it("has no bounding-box flyTo of its own, so the card must move the camera", async () => {
    render(<GlobeView flights={GEO} />);
    flyTo.mockClear();

    act(() => useFlightSelectionStore.getState().setSelection([FLIGHT]));
    await settle();

    expect(flyTo).toHaveBeenCalled();
  });
});
