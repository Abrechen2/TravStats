import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import type { Layer } from "@deck.gl/core";

/**
 * Tester, 2026-11-18: no rail, bus, ferry or roadtrip lines on rc.35 while the
 * map itself ran. The flat map trusted `webgl2Available`, a probe frozen at
 * page load, so one refusal at that moment switched deck.gl off for the whole
 * session. It now asks again when it mounts; only a second "no" keeps deck.gl
 * off — and then says so on screen.
 */

const { drawn, probe } = vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  return { drawn: [] as Layer[][], probe: { answer: true } };
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
  webgl2Available: false,
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

vi.mock("../../lib/webgl2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/webgl2")>()),
  probeWebGL2: () => probe.answer,
}));

import { DeckGLMap } from "../DeckGLMap";

beforeEach(() => {
  drawn.length = 0;
  window.localStorage.clear();
});

describe("the flat map re-checks WebGL2 instead of trusting the page-load probe", () => {
  it("draws its deck.gl layers when the load-time probe said no but WebGL2 is there now", () => {
    probe.answer = true;
    render(<DeckGLMap flights={[]} visMode="routes" />);
    expect(drawn.length).toBeGreaterThan(0);
    expect(screen.queryByTestId("webgl2-missing")).toBeNull();
  });

  it("shows the banner when WebGL2 is still missing at mount", () => {
    probe.answer = false;
    render(<DeckGLMap flights={[]} visMode="routes" />);
    expect(drawn.length).toBe(0);
    expect(screen.getByTestId("webgl2-missing")).toBeInTheDocument();
  });
});
