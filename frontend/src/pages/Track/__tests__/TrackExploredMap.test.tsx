import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { JSX, ReactNode } from "react";

const api = vi.hoisted(() => ({ explored: vi.fn() }));
vi.mock("../../../lib/api/travtrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrack")>()),
  travTrackApi: api,
}));
// The real German copy, so the test reads what the reader sees.
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
/** Every layer the map was handed, with the data of its source. */
const drawn = vi.hoisted(() => ({
  layers: [] as Array<{ id: string; type: string; data: unknown }>,
}));
const mapHandlers = vi.hoisted(() => ({ onLoad: null as null | ((e: unknown) => void) }));
vi.mock("react-map-gl/maplibre", () => {
  let sourceData: unknown = null;
  const MapStub = ({
    children,
    onLoad,
  }: {
    children?: ReactNode;
    onLoad?: (e: unknown) => void;
  }): JSX.Element => {
    mapHandlers.onLoad = onLoad ?? null;
    return <div data-testid="map-instance">{children}</div>;
  };
  const Source = ({ data, children }: { data: unknown; children?: ReactNode }) => {
    sourceData = data;
    return <>{children}</>;
  };
  const Layer = ({ id, type }: { id: string; type: string }) => {
    drawn.layers.push({ id, type, data: sourceData });
    return null;
  };
  return { default: MapStub, Source, Layer, useMap: () => ({}) };
});
vi.mock("../../../components/map/SharedMapOverlays", () => ({ SharedMapOverlays: () => null }));
vi.mock("../../../components/map/useBasemapStyle", () => ({ useBasemapStyle: () => "style.json" }));

import TrackExploredMap, { cellsGeoJson, viewBox } from "../TrackExploredMap";

/**
 * The explored map (TravTrack plan L1): the account's zoom-14 tiles as a
 * MapLibre fill over a fog layer — cells, never points — and a legend that
 * says privacy zones are drawn as explored.
 */

const fakeMap = (bounds: { w: number; s: number; e: number; n: number }) => ({
  target: {
    getBounds: () => ({
      getWest: () => bounds.w,
      getSouth: () => bounds.s,
      getEast: () => bounds.e,
      getNorth: () => bounds.n,
    }),
    fitBounds: vi.fn(),
  },
});

const lastCells = () => {
  const cells = drawn.layers.filter((l) => l.id === "track-explored-cells");
  return cells[cells.length - 1];
};

describe("TrackExploredMap", () => {
  beforeEach(() => {
    drawn.layers = [];
    mapHandlers.onLoad = null;
    api.explored.mockReset();
  });

  it("draws the cells as filled tiles over a fog, never as points", async () => {
    api.explored.mockResolvedValue([
      [8802, 5373],
      [8803, 5373],
    ]);
    render(<TrackExploredMap />);
    await act(async () => mapHandlers.onLoad?.(fakeMap({ w: 13, s: 52, e: 14, n: 53 })));

    await waitFor(() => expect(api.explored).toHaveBeenCalled());
    await waitFor(() => {
      const cells = lastCells();
      expect((cells?.data as GeoJSON.FeatureCollection).features).toHaveLength(2);
    });
    const types = new Set(drawn.layers.map((l) => l.type));
    expect([...types].sort()).toEqual(["fill"]);
    expect(drawn.layers.some((l) => l.id === "track-explored-fog")).toBe(true);
    const last = lastCells();
    for (const f of (last.data as GeoJSON.FeatureCollection).features) {
      expect(f.geometry.type).toBe("Polygon");
    }
  });

  it("says that privacy zones are shown as explored", () => {
    api.explored.mockResolvedValue([]);
    render(<TrackExploredMap />);
    expect(screen.getByText("Privatzonen werden als erkundet gezeigt.")).toBeTruthy();
  });

  it("asks to zoom in when the box holds too many cells", async () => {
    api.explored.mockRejectedValue({
      response: { status: 400, data: { code: "TRAVTRACK_EXPLORED_ZOOM_IN" } },
    });
    render(<TrackExploredMap />);
    await act(async () => mapHandlers.onLoad?.(fakeMap({ w: -180, s: -85, e: 180, n: 85 })));
    expect(await screen.findByRole("status")).toHaveTextContent(/näher heran/);
  });

  it("a map refused for too large privacy zones says so and draws no cell", async () => {
    api.explored.mockRejectedValue({
      response: { status: 409, data: { code: "TRAVTRACK_EXPLORED_UNAVAILABLE" } },
    });
    render(<TrackExploredMap />);
    await act(async () => mapHandlers.onLoad?.(fakeMap({ w: 13, s: 52, e: 14, n: 53 })));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Erkundet-Karte ist für so große Privatzonen nicht verfügbar."
    );
    const cells = lastCells();
    expect((cells?.data as GeoJSON.FeatureCollection).features).toHaveLength(0);
  });

  it("shows a refusal as itself", async () => {
    api.explored.mockRejectedValue({
      response: { status: 403, data: { code: "TRAVTRACK_DISABLED" } },
    });
    render(<TrackExploredMap />);
    await act(async () => mapHandlers.onLoad?.(fakeMap({ w: 13, s: 52, e: 14, n: 53 })));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ausgeschaltet/);
  });
});

describe("cellsGeoJson", () => {
  it("is one square tile polygon per cell", () => {
    const fc = cellsGeoJson([[8192, 8191]]);
    expect(fc.features).toHaveLength(1);
    const ring = (fc.features[0].geometry as GeoJSON.Polygon).coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0][0]).toBeCloseTo(0, 6);
    expect(ring[0][1]).toBeGreaterThan(0);
    expect(ring[2][0]).toBeCloseTo(360 / 16384, 6);
  });
});

describe("viewBox", () => {
  it("is the map's bounds, wrapped into one world and clamped to the grid", () => {
    expect(viewBox({ west: 13, south: 52, east: 14, north: 53 })).toEqual({
      west: 13,
      south: 52,
      east: 14,
      north: 53,
    });
    expect(viewBox({ west: -200, south: -89, east: 200, north: 89 })).toEqual({
      west: -180,
      south: -85,
      east: 180,
      north: 85,
    });
    // Across the antimeridian: west past east.
    expect(viewBox({ west: 170, south: 0, east: 190, north: 10 })).toEqual({
      west: 170,
      south: 0,
      east: -170,
      north: 10,
    });
  });
});
