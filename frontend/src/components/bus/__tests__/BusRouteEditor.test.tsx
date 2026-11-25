import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";

import { rideFixture } from "./busFixture";

/** The deck line, captured so the test can click a segment like a map click would. */
const pathLayers = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@deck.gl/layers", () => ({
  PathLayer: class {
    constructor(props: Record<string, unknown>) {
      pathLayers.push(props);
    }
  },
}));
vi.mock("react-map-gl/maplibre", () => ({
  default: function MapStub({ children, onLoad }: { children: ReactNode; onLoad?: () => void }) {
    useEffect(() => onLoad?.(), [onLoad]);
    return <div data-testid="map">{children}</div>;
  },
  Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useControl: () => ({ setProps: vi.fn() }),
}));
vi.mock("../../map/DeckGLOverlay", () => ({ DeckGLOverlay: () => null }));
vi.mock("../../map/useBasemapStyle", () => ({ useBasemapStyle: () => "style.json" }));
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colorOf: () => "#5686b8" }),
}));
const setManualRoute = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/bus", () => ({ busApi: { setManualRoute } }));

import {
  BUS_EDITOR_HANDLES,
  BusRouteEditor,
  editorBounds,
  editorStartLine,
} from "../BusRouteEditor";

const ride = { ...rideFixture(), geometry: null, geometrySource: "straight" as const };
const clickSegment = (index: number, coordinate: [number, number]) => {
  const onClick = pathLayers[pathLayers.length - 1].onClick as (info: unknown) => boolean;
  act(() => {
    onClick({ index, coordinate });
  });
};
const addPointAndSave = async () => {
  clickSegment(0, [(ride.depLon + ride.arrLon) / 2, ride.depLat + 0.3]);
  const save = await screen.findByTestId("bus-route-editor-save");
  await waitFor(() => expect(save).toBeEnabled());
  await act(async () => {
    fireEvent.click(save);
  });
};

describe("BusRouteEditor (GitHub #409)", () => {
  beforeEach(() => {
    pathLayers.length = 0;
    setManualRoute.mockReset();
  });

  it("starts from the chord between the stops, or from a stored line", () => {
    expect(editorStartLine(ride)).toEqual([
      [ride.depLon, ride.depLat],
      [ride.arrLon, ride.arrLat],
    ]);
    const stored: Array<[number, number]> = [
      [ride.depLon, ride.depLat],
      [127.5, 37.9],
      [ride.arrLon, ride.arrLat],
    ];
    expect(editorStartLine({ ...ride, geometry: stored, geometrySource: "road" })).toEqual(stored);
  });

  it("a short road line keeps few handles and is framed at its own size, so the line stays visible", () => {
    // A 5 km city ride with a 200-point road line (rc46 UAT: only circles, no line).
    const road: Array<[number, number]> = Array.from({ length: 200 }, (_, i) => {
      const t = i / 199;
      return [11.55 + 0.05 * t + 0.004 * Math.sin(t * 30), 48.142 + 0.028 * t];
    });
    const line = editorStartLine({ ...ride, geometry: road, geometrySource: "road" });
    expect(line.length).toBeLessThanOrEqual(BUS_EDITOR_HANDLES);
    const [[w, s], [e, n]] = editorBounds(line);
    // Framed around the line (a few km), not padded by 0.3° (~30 km) on each side.
    expect(e - w).toBeLessThan(0.1);
    expect(n - s).toBeLessThan(0.1);
    expect(w).toBeLessThan(11.55);
    expect(e).toBeGreaterThan(11.6);
  });

  it("offers no save until a via point was added, then sends the whole line with the version", async () => {
    const onSaved = vi.fn();
    setManualRoute.mockResolvedValue(ride);
    await act(async () => {
      render(<BusRouteEditor ride={ride} onSaved={onSaved} onClose={vi.fn()} />);
    });
    expect(screen.getByTestId("bus-route-editor-save")).toBeDisabled();
    const via: [number, number] = [(ride.depLon + ride.arrLon) / 2, ride.depLat + 0.3];
    await addPointAndSave();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(setManualRoute).toHaveBeenCalledWith(
      ride.id,
      [[ride.depLon, ride.depLat], via, [ride.arrLon, ride.arrLat]],
      ride.updatedAt
    );
  });

  it("shows the server's reason for a refused line, not a raw code", async () => {
    setManualRoute.mockRejectedValue({
      response: { data: { error: "bad", code: "BUS_ROUTE_NOT_ANCHORED" } },
    });
    const onSaved = vi.fn();
    await act(async () => {
      render(<BusRouteEditor ride={ride} onSaved={onSaved} onClose={vi.fn()} />);
    });
    await addPointAndSave();
    expect((await screen.findByTestId("bus-route-editor-error")).textContent).toBe(
      "bus:routeEditor.errors.BUS_ROUTE_NOT_ANCHORED"
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("falls back to the generic sentence for an unknown failure", async () => {
    setManualRoute.mockRejectedValue(new Error("network"));
    await act(async () => {
      render(<BusRouteEditor ride={ride} onSaved={vi.fn()} onClose={vi.fn()} />);
    });
    await addPointAndSave();
    expect((await screen.findByTestId("bus-route-editor-error")).textContent).toBe(
      "bus:routeEditor.failed"
    );
  });
});
