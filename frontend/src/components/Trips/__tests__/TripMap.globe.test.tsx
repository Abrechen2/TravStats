import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import type { Layer } from "@deck.gl/core";
import type { Trip } from "../../../types";

/**
 * The trip map's globe toggle drew an EMPTY globe. Two of the three causes
 * live in how the deck.gl overlay is MOUNTED rather than in what it draws,
 * and `GlobeView.tsx` had both written down already:
 *
 *   - without `interleaved: true` the overlay does not share MapLibre's WebGL
 *     context, so it keeps its own mercator matrices and the data detaches
 *     into a flat strip beside the sphere;
 *   - `MapboxOverlay` is a render-pipeline integration, not a corner widget,
 *     so passing `position` to `useControl` mounts it as one and confuses its
 *     lifecycle. TripMap passed `{ position: "top-left" }`.
 *
 * And the third: `MapboxOverlay`'s constructor runs inside `useControl`,
 * which fires BEFORE any projection change lands. An overlay built while
 * MapLibre is still in mercator caches that and never re-detects globe — so
 * the overlay has to be rebuilt AFTER `setProjection({type:"globe"})`, which
 * is what `mapReady` does in GlobeView.
 *
 * This test drives the real TripMap through its toggle and reads what the
 * overlay was actually constructed with. It cannot say the globe LOOKS right
 * — jsdom draws no pixels — so a browser look is still the acceptance. It can
 * say the overlay is mounted the way the working globe mounts it.
 */

interface CapturedOverlay {
  /** The live instance, so a test can call the handlers TripMap pushes
   *  through `setProps` on every render. */
  overlay: { props: { onClick?: (info: unknown) => void } };
  props: { layers: Layer[]; interleaved?: boolean };
  controlOptions: unknown;
  /** How many `setProjection` calls had already happened when this overlay
   *  was constructed — the ordering the whole gate exists for. */
  projectionCallsBefore: number;
}

const { captured, mapCalls } = vi.hoisted(() => ({
  captured: [] as CapturedOverlay[],
  mapCalls: {
    setProjection: [] as unknown[],
    setSky: [] as unknown[],
    fitBounds: [] as Array<{ maxZoom?: number }>,
    flyTo: [] as Array<{ zoom?: number }>,
    skyThrows: false,
  },
}));

vi.mock("react-map-gl/maplibre", async () => {
  const ReactMod = await import("react");
  const fakeMap = {
    setProjection: (p: unknown) => mapCalls.setProjection.push(p),
    setSky: (s: unknown) => {
      mapCalls.setSky.push(s);
      if (mapCalls.skyThrows) throw new Error("this style has no sky");
    },
    on: () => {},
    off: () => {},
    once: () => {},
    getZoom: () => 2,
    getCenter: () => ({ lng: 0, lat: 0 }),
    getCanvas: () => ({ style: {} }),
    getContainer: () => document.createElement("div"),
    fitBounds: (_bounds: unknown, opts?: { maxZoom?: number }) => {
      mapCalls.fitBounds.push(opts ?? {});
    },
    flyTo: (opts?: { zoom?: number }) => {
      mapCalls.flyTo.push(opts ?? {});
    },
    easeTo: () => {},
    project: () => ({ x: 0, y: 0 }),
  };

  const MockMapGL = ReactMod.forwardRef(function MockMapGL(
    props: { onLoad?: (e: { target: typeof fakeMap }) => void; children?: React.ReactNode },
    ref: React.Ref<unknown>
  ) {
    ReactMod.useImperativeHandle(ref, () => ({ getMap: () => fakeMap }), []);
    ReactMod.useEffect(() => {
      props.onLoad?.({ target: fakeMap });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return ReactMod.createElement("div", { "data-testid": "fake-map" }, props.children);
  });

  // react-map-gl's real contract: the factory runs once per mounted control,
  // and the second argument is the control's mount options. Both matter here.
  function useControl<T>(factory: () => T, options?: unknown): T {
    const ref = ReactMod.useRef<T | null>(null);
    const seen = ReactMod.useRef(false);
    if (ref.current === null) {
      ref.current = factory();
      if (!seen.current) {
        seen.current = true;
        captured[captured.length - 1].controlOptions = options;
      }
    }
    return ref.current;
  }

  return { __esModule: true, default: MockMapGL, useControl, useMap: () => ({ current: null }) };
});

vi.mock("@deck.gl/mapbox", () => {
  class MockMapboxOverlay {
    props: { layers: Layer[]; interleaved?: boolean; onClick?: (info: unknown) => void };
    constructor(props: { layers: Layer[]; interleaved?: boolean }) {
      this.props = props;
      captured.push({
        overlay: this,
        props,
        controlOptions: undefined,
        projectionCallsBefore: mapCalls.setProjection.length,
      });
    }
    setProps(next: Record<string, unknown>): void {
      this.props = { ...this.props, ...next };
    }
  }
  return { MapboxOverlay: MockMapboxOverlay };
});

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

vi.mock("../../../lib/api/cruise", () => ({
  cruiseApi: { getGeometryBatch: vi.fn(async () => new Map()) },
}));

import TripMap from "../TripMap";

const trip = {
  id: "t1",
  name: "Iceland",
  flights: [
    {
      id: "f1",
      depIata: "MUC",
      arrIata: "KEF",
      depLat: 48.3537,
      depLon: 11.786,
      arrLat: 63.985,
      arrLon: -22.6056,
      status: "flown",
    },
  ],
  stops: [{ id: "s1", title: "Reykjavík", domain: "poi", lat: 64.1466, lon: -21.9426 }],
} as unknown as Trip;

beforeEach(() => {
  captured.length = 0;
  mapCalls.setProjection.length = 0;
  mapCalls.setSky.length = 0;
  mapCalls.fitBounds.length = 0;
  mapCalls.flyTo.length = 0;
  mapCalls.skyThrows = false;
  window.localStorage.clear();
});

// The toggle is the only `aria-pressed` control on this map, and it reports
// `false` while mercator is showing — a stabler handle than its emoji label.
async function toggleToGlobe(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { pressed: false }));
}

describe("TripMap: the globe toggle mounts the overlay the way the globe needs it", () => {
  it("never mounts the overlay as a corner control", async () => {
    render(<TripMap trip={trip} />);
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    await toggleToGlobe();
    await waitFor(() => expect(captured.length).toBeGreaterThan(1));
    for (const overlay of captured) {
      expect(overlay.controlOptions, "MapboxOverlay is a pipeline, not a widget").toBeUndefined();
    }
  });

  it("interleaves with MapLibre's context in globe mode, and only there", async () => {
    render(<TripMap trip={trip} />);
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].props.interleaved).toBeFalsy();

    await toggleToGlobe();
    await waitFor(() => expect(captured.length).toBeGreaterThan(1));
    expect(captured[captured.length - 1].props.interleaved).toBe(true);
  });

  it("rebuilds the overlay AFTER the projection changed, never before", async () => {
    render(<TripMap trip={trip} />);
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));

    await toggleToGlobe();
    await waitFor(() => expect(captured.length).toBeGreaterThan(1));

    expect(mapCalls.setProjection).toContainEqual({ type: "globe" });
    const globeOverlay = captured[captured.length - 1];
    expect(
      globeOverlay.projectionCallsBefore,
      "an overlay built before setProjection caches mercator forever"
    ).toBeGreaterThan(0);
  });

  it("paints a horizon, because a globe without sky has none", async () => {
    render(<TripMap trip={trip} />);
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    await toggleToGlobe();
    await waitFor(() => expect(mapCalls.setSky.length).toBeGreaterThan(0));
  });

  it("refits the trip so the globe fills the frame instead of opening at street zoom", async () => {
    render(<TripMap trip={trip} />);
    await waitFor(() => expect(mapCalls.fitBounds.length).toBeGreaterThan(0));
    const before = mapCalls.fitBounds.length;
    await toggleToGlobe();
    await waitFor(() => expect(mapCalls.fitBounds.length).toBeGreaterThan(before));
    expect(mapCalls.fitBounds[mapCalls.fitBounds.length - 1].maxZoom).toBe(3);
  });

  it("does not let a failing setSky leave React and MapLibre disagreeing", async () => {
    // `setSky` is wrapped because a style source may not support a sky. It sat
    // INSIDE the same try as the React state update though, so a throw left
    // MapLibre in globe projection — `setProjection` had already run — while
    // React still believed mercator, and the overlay stayed non-interleaved.
    // That is the original bug, reported as a warning and then hidden.
    render(<TripMap trip={trip} />);
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    mapCalls.skyThrows = true;

    await toggleToGlobe();

    expect(mapCalls.setProjection).toContainEqual({ type: "globe" });
    await waitFor(() => expect(captured.length).toBeGreaterThan(1));
    expect(
      captured[captured.length - 1].props.interleaved,
      "MapLibre is on the globe; the overlay must be too"
    ).toBe(true);
  });

  it("caps a fly-to at globe zoom, so one click cannot flatten the sphere", async () => {
    // MapLibre switches the globe to a plane above a zoom threshold. The fit
    // was taught about that; the click handlers were not, so clicking a stop
    // (zoom 11) or a hotel (12) turned the globe flat while the toggle still
    // read as globe.
    render(<TripMap trip={trip} />);
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));

    const clickStop = (): void => {
      const onClick = captured[captured.length - 1].overlay.props.onClick;
      onClick?.({
        layer: { id: "trip-stops" },
        object: { position: [13.4, 52.52], kind: "stop" },
      });
    };

    clickStop();
    expect(mapCalls.flyTo[mapCalls.flyTo.length - 1].zoom).toBe(11);

    await toggleToGlobe();
    await waitFor(() => expect(captured.length).toBeGreaterThan(1));
    clickStop();
    expect(mapCalls.flyTo[mapCalls.flyTo.length - 1].zoom).toBeLessThanOrEqual(3);
  });

  it("caps a fly-to-bbox on the globe as well as the fit", async () => {
    render(<TripMap trip={trip} />);
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    await toggleToGlobe();
    await waitFor(() => expect(captured.length).toBeGreaterThan(1));

    const before = mapCalls.fitBounds.length;
    const onClick = captured[captured.length - 1].overlay.props.onClick;
    onClick?.({
      layer: { id: "trip-flight-arcs" },
      object: { source: [11.786, 48.3537], target: [-22.6056, 63.985] },
    });
    expect(mapCalls.fitBounds.length).toBeGreaterThan(before);
    expect(mapCalls.fitBounds[mapCalls.fitBounds.length - 1].maxZoom).toBe(3);
  });

  it("draws the flight as a path, not an ArcLayer, once the globe is on", async () => {
    render(<TripMap trip={trip} />);
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    await toggleToGlobe();
    await waitFor(() => expect(captured.length).toBeGreaterThan(1));
    const layers = captured[captured.length - 1].props.layers;
    const arcs = layers.find((l) => l.id === "trip-flight-arcs");
    expect(arcs).toBeDefined();
    expect(arcs?.constructor.name).toBe("PathLayer");
  });
});
