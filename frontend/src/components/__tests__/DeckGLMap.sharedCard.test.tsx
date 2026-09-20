import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import * as React from "react";

/**
 * The owner ruled on 2026-09-20, from two screenshots, that the globe's click
 * card is the map card and the flat map's five ad-hoc tooltips go. This mounts
 * the REAL `DeckGLMap` with a selection in the store and proves the card that
 * appears is the SHARED one — the same component the globe mounts — rather
 * than `MapTooltip` / `TripTooltip` / `AirportTooltip` / `CruiseTooltip` /
 * `SpecialFlightTooltip`.
 *
 * Deliberate-break protocol: point DeckGLMap back at any of the five deleted
 * components, or drop `PinnedCard` from its render — this test fails.
 */

const { cardProps } = vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  return { cardProps: [] as Array<Record<string, unknown>> };
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
    props: { children?: React.ReactNode },
    ref: React.Ref<unknown>
  ) {
    React.useImperativeHandle(ref, () => ({ getMap: () => fakeMap }), []);
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

// The card itself has its own suite; here we only need to know WHICH component
// the flat map mounted and what it handed it.
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

import { DeckGLMap } from "../DeckGLMap";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import { useCruiseSelectionStore } from "../../store/cruiseSelectionStore";
import { useMapCameraStore } from "../../store/mapCameraStore";
import type { Flight, GeoJSONFeature } from "../../types";

function leg(id: string, dep: string, arr: string): GeoJSONFeature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [10, 50],
        [20, 40],
      ],
    },
    properties: {
      id,
      airline: "Delta Air Lines",
      flightNumber: "DL6287",
      departureAirport: { iata: dep, name: `${dep} Airport`, country: "NO" },
      arrivalAirport: { iata: arr, name: `${arr} Airport`, country: "ES" },
      departureTime: "2021-06-05T08:00:00Z",
      arrivalTime: "2021-06-05T12:00:00Z",
      status: "flown",
      distance: 3931,
    },
  } as unknown as GeoJSONFeature;
}

function flight(id: string): Flight {
  return {
    id,
    depIata: "TOS",
    arrIata: "AGP",
    depLon: 10,
    depLat: 50,
    arrLon: 20,
    arrLat: 40,
    departureTime: "2021-06-05T08:00:00Z",
  } as unknown as Flight;
}

beforeEach(() => {
  cardProps.length = 0;
  useFlightSelectionStore.getState().clearSelection();
  useCruiseSelectionStore.getState().clearSelection();
  useMapCameraStore.setState({ camera: {} });
  window.localStorage.clear();
  vi.useFakeTimers();
});

/**
 * Past the card's TOOLTIP_DELAY_MS, and no further: `usePulseAnimation` drives
 * a self-rescheduling rAF, so `runAllTimers` here is an infinite loop rather
 * than a settled state.
 */
async function settle(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
}

describe("the flat map draws the shared card", () => {
  it("opens the route card on a flight selection, with the flight and an edit action", async () => {
    const geo = [leg("f1", "TOS", "AGP")];
    render(<DeckGLMap flights={geo} visMode="routes" onEdit={vi.fn()} />);

    act(() => {
      useFlightSelectionStore.getState().setSelection([flight("f1")]);
    });
    await settle();

    expect(screen.getByTestId("shared-pinned-card")).toBeInTheDocument();
    const props = cardProps[cardProps.length - 1];
    expect((props.pinned as { kind: string }).kind).toBe("arc");
    // One flight selected is not the whole route — the action says so.
    expect(props.selectionScope).toBe("single");
    // "Bearbeiten" survives the move: it was the flat card's action and is
    // now the shared card's second one.
    expect(props.onFlightEdit).toBeTypeOf("function");
  });

  it("opens the trip card for a selection spanning more than one airport pair", async () => {
    const geo = [leg("f1", "TOS", "AGP"), leg("f2", "AGP", "OSL")];
    render(<DeckGLMap flights={geo} visMode="routes" />);

    act(() => {
      useFlightSelectionStore.getState().setSelection([flight("f1"), flight("f2")]);
    });
    await settle();

    const props = cardProps[cardProps.length - 1];
    expect((props.pinned as { kind: string }).kind).toBe("trip");
  });

  it("opens the cruise card instead of the old bottom-of-screen cruise tooltip", async () => {
    render(<DeckGLMap flights={[]} visMode="routes" />);

    act(() => {
      useCruiseSelectionStore.getState().setSelection({
        id: "c1",
        stops: [],
        ship: { name: "AIDAnova" },
        departurePort: { lon: 12, lat: 42 },
        arrivalPort: { lon: 12, lat: 42 },
      } as never);
    });
    await settle();

    const props = cardProps[cardProps.length - 1];
    expect((props.pinned as { kind: string }).kind).toBe("cruise");
  });
});
