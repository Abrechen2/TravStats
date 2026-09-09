import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

/**
 * #290: every dashboard tab owns its own `MapContainer3D`, so switching
 * domains (or saving an entry, which remounts the tab) mounts a fresh
 * `DeckGLMap`. It handed MapLibre a constant `initialViewState`, and
 * `reuseMaps` re-applies exactly that on every reuse — a user zoomed into
 * Berlin on the flight tab landed back at zoom 2 on the cruise tab.
 *
 * This mounts the REAL DeckGLMap against a fake `<Map>` that only records
 * what it was given: the `initialViewState` it would seed the camera from and
 * the `onMoveEnd` it would call when the user stops panning. The proof is
 * the round trip — a moveend on the first mount must become the seed of the
 * second — and nothing about WebGL or deck.gl is needed for that, so both are
 * stubbed (jsdom has neither anyway).
 *
 * Deliberate-break protocol: seed `initialViewState` from the constant again
 * (`initialViewState={INITIAL_VIEW_STATE}` in DeckGLMap.tsx), or drop the
 * `onMoveEnd` prop — this test fails either way.
 */

const { captured } = vi.hoisted(() => {
  // DeckGLMap probes for WebGL2 at import time; jsdom's stub getContext logs
  // a "not implemented" error on every call, so answer "none" quietly.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  return {
    captured: [] as Array<{
      initialViewState: Record<string, unknown> | undefined;
      onMoveEnd: ((e: { viewState: Record<string, number> }) => void) | undefined;
    }>,
  };
});

vi.mock("react-map-gl/maplibre", () => {
  const fakeMap = {
    on: vi.fn(),
    off: vi.fn(),
    getZoom: vi.fn(() => 2),
    project: vi.fn(() => ({ x: 0, y: 0 })),
    getCanvas: vi.fn(() => ({ style: {} })),
    getContainer: vi.fn(() => document.createElement("div")),
  };
  const MockMapGL = React.forwardRef(function MockMapGL(
    props: {
      initialViewState?: Record<string, unknown>;
      onMoveEnd?: (e: { viewState: Record<string, number> }) => void;
      children?: React.ReactNode;
    },
    ref: React.Ref<unknown>
  ) {
    React.useImperativeHandle(ref, () => ({ getMap: () => fakeMap }), []);
    // Recorded on every render so the LAST entry per mount is what MapLibre
    // would actually have seen — the seed must be read once, not re-derived.
    captured.push({ initialViewState: props.initialViewState, onMoveEnd: props.onMoveEnd });
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

// Chrome around the map — none of it is what #290 is about, and none of it
// can drive its own prop contracts under jsdom.
vi.mock("../map/FlatMapControlPanel", () => ({ FlatMapControlPanel: () => null }));
vi.mock("../TimeSlider", () => ({ TimeSlider: () => null }));
vi.mock("../NativeRoutesLayer", () => ({
  NativeRoutesLayer: () => null,
  NATIVE_ROUTE_LINE_ID: "native-route-line",
  NATIVE_AIRPORT_CIRCLE_ID: "native-airport-circle",
}));
vi.mock("../Globe/mapOverlays", () => ({ applyMapOverlays: vi.fn() }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

// Imported after the mocks above so the module graph picks them up.
import { DeckGLMap } from "../DeckGLMap";
import { useMapCameraStore } from "../../store/mapCameraStore";

beforeEach(() => {
  captured.length = 0;
  useMapCameraStore.setState({ camera: {} });
  window.localStorage.clear();
});

describe("DeckGLMap: the camera survives a remount", () => {
  it("remembers the camera across an unmount and remount — the domain switch that used to zoom out (#290)", () => {
    const first = render(<DeckGLMap flights={[]} visMode="routes" />);
    const firstSeed = captured[captured.length - 1].initialViewState;
    expect(firstSeed).toMatchObject({ longitude: 10, latitude: 30, zoom: 2 });

    // The user pans to Berlin and lets go.
    const onMoveEnd = captured[captured.length - 1].onMoveEnd;
    expect(onMoveEnd).toBeTypeOf("function");
    onMoveEnd?.({ viewState: { longitude: 13.4, latitude: 52.5, zoom: 7, pitch: 0, bearing: 0 } });

    // Another tab: a brand-new DeckGLMap.
    first.unmount();
    captured.length = 0;
    render(<DeckGLMap flights={[]} visMode="routes" />);

    const secondSeed = captured[captured.length - 1].initialViewState;
    expect(secondSeed).toMatchObject({ longitude: 13.4, latitude: 52.5, zoom: 7 });
  });
});
