import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import * as React from "react";
import type { Layer } from "@deck.gl/core";
import type { Trip } from "../../../types";

/**
 * The trip map's day filter, names, numbers, info card and legend (owner,
 * 2026-11-20: "Die Karte in Reisen zeigt nur die Labels der Hotels"). The real
 * TripMap is driven through the overlay it hands deck.gl; jsdom draws no
 * pixels, so a browser look stays the acceptance for how it reads.
 */

interface CapturedOverlay {
  /** The live instance, so a test can call the handlers TripMap pushes
   *  through `setProps` on every render. */
  overlay: { props: { onClick?: (info: unknown) => void } };
  props: { layers: Layer[]; interleaved?: boolean };
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
    zoom: 2,
    nativeLayers: [] as string[],
    nativeSources: new Set<string>(),
    styleListeners: new Set<() => void>(),
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
    on: (event: string, listener: () => void) => {
      if (event === "style.load") mapCalls.styleListeners.add(listener);
    },
    off: (event: string, listener: () => void) => {
      if (event === "style.load") mapCalls.styleListeners.delete(listener);
    },
    once: () => {},
    getZoom: () => mapCalls.zoom,
    getStyle: () => ({ version: 8, layers: [] }),
    getCenter: () => ({ lng: 0, lat: 0 }),
    getCanvas: () => ({
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    // The native layers (forgejo#331): a minimal in-memory style.
    getLayer: (id: string) => (mapCalls.nativeLayers.includes(id) ? { id } : undefined),
    getSource: (id: string) => (mapCalls.nativeSources.has(id) ? { setData: () => {} } : undefined),
    addSource: (id: string) => mapCalls.nativeSources.add(id),
    addLayer: (layer: { id: string }) => mapCalls.nativeLayers.push(layer.id),
    removeLayer: () => {},
    removeSource: () => {},
    setPaintProperty: () => {},
    setLayoutProperty: () => {},
    setFilter: () => {},
    removeFeatureState: () => {},
    queryRenderedFeatures: () => [],
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
    }, []);
    return ReactMod.createElement("div", { "data-testid": "fake-map" }, props.children);
  });

  // react-map-gl's real contract: the factory runs once per mounted control.
  function useControl<T>(factory: () => T): T {
    const ref = ReactMod.useRef<T | null>(null);
    if (ref.current === null) ref.current = factory();
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

vi.mock("../../Globe/GlobeLabelsOverlay", () => ({
  GlobeLabelsOverlay: () => null,
}));

import TripMap from "../TripMap";
import { useTripMapInfoStore } from "../../../store/tripMapInfoStore";

const flight = (id: string, dep: string, day: string, lat: number, lon: number): unknown => ({
  id,
  depIata: dep,
  arrIata: "KEF",
  depLat: lat,
  depLon: lon,
  arrLat: 63.985,
  arrLon: -22.6056,
  departureTime: `${day}T08:00:00Z`,
  arrivalTime: `${day}T12:00:00Z`,
  depTimezone: "UTC",
  arrTimezone: "UTC",
  status: "flown",
});

const trip = {
  id: "t1",
  flights: [
    flight("f1", "MUC", "2026-05-01", 48.3537, 11.786),
    flight("f2", "FRA", "2026-05-03", 50.0379, 8.5622),
  ],
  lodgingStays: [
    {
      id: "st1",
      checkIn: "2026-05-01",
      checkOut: "2026-05-02",
      lodging: {
        id: "l1",
        name: "Hotel Borg",
        city: "Reykjavik",
        lat: 64.1466,
        lon: -21.9426,
        type: "hotel",
      },
    },
  ],
  stops: [
    {
      id: "s2",
      title: "Gullfoss",
      domain: "poi",
      lat: 64.327,
      lon: -20.12,
      startDate: "2026-05-03",
      endDate: null,
    },
    {
      id: "s1",
      title: "Thingvellir",
      domain: "poi",
      lat: 64.255,
      lon: -21.13,
      startDate: "2026-05-02",
      endDate: null,
    },
  ],
} as unknown as Trip;

const places = [
  {
    id: "p1",
    visitId: "v1",
    name: "Hallgrimskirkja",
    position: [-21.93, 64.142] as [number, number],
    span: { start: "2026-05-01", end: "2026-05-01" },
    subtitle: "landmark",
    order: 0,
  },
];

const layersNow = (): Layer[] =>
  (captured[captured.length - 1].overlay.props as unknown as { layers: Layer[] }).layers;
const layerById = (id: string): Layer | undefined => layersNow().find((l) => l.id === id);

function Where(): JSX.Element {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search + l.hash}</p>;
}

function mount(props: Partial<React.ComponentProps<typeof TripMap>> = {}): void {
  render(
    <MemoryRouter initialEntries={["/trips/t1?tab=map"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <TripMap trip={trip} tripId="t1" places={places} {...props} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  captured.length = 0;
  mapCalls.styleListeners.clear();
  mapCalls.setProjection.length = 0;
  mapCalls.setSky.length = 0;
  mapCalls.fitBounds.length = 0;
  mapCalls.flyTo.length = 0;
  window.localStorage.clear();
  mapCalls.zoom = 2;
  useTripMapInfoStore.getState().close();
});

describe("trip map: day filter", () => {
  it("dims the flights, stops and hotels that are not on the chosen day", async () => {
    mount({ day: "2026-05-01" });
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const arcs = layerById("trip-flight-arcs")?.props.data as Array<{
      flightId: string;
      dim: boolean;
    }>;
    expect(arcs.map((a) => [a.flightId, a.dim])).toEqual([
      ["f1", false],
      ["f2", true],
    ]);
    const stops = layerById("trip-stops")?.props.data as Array<{ label: string; dim: boolean }>;
    expect(stops.map((s) => [s.label, s.dim])).toEqual([
      ["Gullfoss", true],
      ["Thingvellir", true],
    ]);
    // The hotel is slept in on the 1st: drawn live, nothing of it faint.
    expect(layerById("lodging-pins-dim")).toBeUndefined();
    expect(layerById("lodging-pins")).toBeDefined();
  });

  it("draws the hotel faint on a day it is not used", async () => {
    mount({ day: "2026-05-03" });
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(layerById("lodging-pins")).toBeUndefined();
    expect(layerById("lodging-pins-dim")?.props.opacity).toBeLessThan(0.5);
  });

  it("dims nothing without a day", async () => {
    mount();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const arcs = layerById("trip-flight-arcs")?.props.data as Array<{ dim: boolean }>;
    expect(arcs.some((a) => a.dim)).toBe(false);
  });
});

describe("trip map: names and numbers", () => {
  it("names airports, stops and places, not only the hotels", async () => {
    mapCalls.zoom = 14; // the zoom budget and spacing are the reader's: close in, every name fits
    mount();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const names = (layerById("trip-name-labels")?.props.data as Array<{ text: string }>).map(
      (d) => d.text
    );
    expect(names).toEqual(expect.arrayContaining(["Gullfoss", "Thingvellir", "Hallgrimskirkja"]));
    expect(names).toEqual(expect.arrayContaining(["MUC"]));
  });

  it("numbers stops and places in trip order, not in the order they were entered", async () => {
    mapCalls.zoom = 14;
    mount();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const numbered = layerById("trip-sequence")?.props.data as Array<{ text: string; seq: number }>;
    const bySeq = [...numbered].sort((a, b) => a.seq - b.seq).map((d) => d.text);
    // Hallgrimskirkja 1 May, Thingvellir 2 May, Gullfoss 3 May — entered Gullfoss first.
    expect(bySeq).toEqual(["Hallgrimskirkja", "Thingvellir", "Gullfoss"]);
  });

  it("puts a direction arrow on each flight line", async () => {
    mount();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect((layerById("trip-direction-arrows")?.props.data as unknown[]).length).toBe(2);
  });
});

describe("trip map: info card", () => {
  it("opens a persistent card for a hotel with a working link to its page and the timeline", async () => {
    mount();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    act(() => {
      captured[captured.length - 1].overlay.props.onClick?.({
        object: { position: [-21.9426, 64.1466], lodgingId: "l1" },
        layer: { id: "lodging-pins" },
      });
    });
    const card = await screen.findByTestId("trip-map-info-card");
    expect(card).toHaveTextContent("Hotel Borg");
    expect(card).toHaveTextContent("trips:detail.map.info.kind.lodging");
    await userEvent.click(screen.getByText("trips:detail.map.info.openEntity"));
    expect(screen.getByTestId("where")).toHaveTextContent("/lodging/l1");
  });

  it("links a stop to its row in the timeline", async () => {
    mount();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const data = layerById("trip-stops")?.props.data as Array<{
      entityId: string;
      position: number[];
    }>;
    act(() => {
      captured[captured.length - 1].overlay.props.onClick?.({
        object: { ...data[1], label: "Thingvellir" },
        layer: { id: "trip-stops" },
      });
    });
    await userEvent.click(await screen.findByText("trips:detail.map.info.openTimeline"));
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/trips/t1?tab=timeline#timeline-stop-s1"
    );
  });

  it("stays open until it is closed", async () => {
    mount();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    act(() => {
      useTripMapInfoStore.getState().open({
        key: "stop:s1",
        kind: "stop",
        title: "Thingvellir",
        span: null,
        entityHref: null,
        timelineHref: null,
      });
    });
    expect(await screen.findByTestId("trip-map-info-card")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("trips:detail.map.info.close"));
    expect(screen.queryByTestId("trip-map-info-card")).toBeNull();
  });
});

const dataOfFlights = (): unknown[] =>
  (layerById("trip-flight-arcs")?.props.data as unknown[]) ?? [];

describe("trip map: legend", () => {
  it("lists the layers present and hides one when its row is switched off", async () => {
    mount();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(dataOfFlights()).toHaveLength(2);
    const row = screen.getByRole("switch", { name: /legend\.group\.flights/ });
    expect(row).toHaveAttribute("aria-checked", "true");
    await userEvent.click(row);
    expect(screen.getByRole("switch", { name: /legend\.group\.flights/ })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    const dataOf = (id: string): unknown[] => (layerById(id)?.props.data as unknown[]) ?? [];
    await waitFor(() => expect(dataOf("trip-flight-arcs")).toHaveLength(0));
    expect(dataOf("trip-airports")).toHaveLength(0);
    expect(layerById("trip-direction-arrows")).toBeUndefined();
    // Everything else stays.
    expect(dataOf("trip-stops")).toHaveLength(2);
  });

  it("offers no row for a layer the trip does not have", async () => {
    mount();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(screen.queryByRole("switch", { name: /legend\.group\.rail/ })).toBeNull();
    expect(screen.queryByRole("switch", { name: /legend\.group\.recording/ })).toBeNull();
  });
});
