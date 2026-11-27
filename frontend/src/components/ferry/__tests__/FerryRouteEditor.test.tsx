import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";

import { ferryFixture } from "./ferryFixture";

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
const routePair = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/ferry", () => ({ ferryApi: { setManualRoute, routePair } }));

import { FerryRouteEditor, editorStartLine } from "../FerryRouteEditor";
import { RIDE_EDITOR_HANDLES, rideEditorBounds } from "../../map/routeEditorFraming";

const ride = ferryFixture({ geometry: null, geometrySource: "straight" });
const clickSegment = (index: number, coordinate: [number, number]) => {
  const onClick = pathLayers[pathLayers.length - 1].onClick as (info: unknown) => boolean;
  act(() => {
    onClick({ index, coordinate });
  });
};

describe("FerryRouteEditor", () => {
  beforeEach(() => {
    pathLayers.length = 0;
    setManualRoute.mockReset();
    routePair.mockReset();
    routePair.mockResolvedValue({ count: 3, from: "Galtby", to: "Långnäs", hasPairLine: false });
  });

  it("a short crossing keeps few handles and is framed at its own size, so the line stays visible", () => {
    // A 6 km harbour crossing with a 200-point sea line (rc46 UAT on the bus editor: only circles).
    const sea: Array<[number, number]> = Array.from({ length: 200 }, (_, i) => {
      const t = i / 199;
      return [10.0 + 0.06 * t + 0.003 * Math.sin(t * 30), 53.5 + 0.02 * t];
    });
    const line = editorStartLine({ ...ride, geometry: sea, geometrySource: "sea_route" });
    expect(line.length).toBeLessThanOrEqual(RIDE_EDITOR_HANDLES);
    const [[w, s], [e, n]] = rideEditorBounds(line);
    expect(e - w).toBeLessThan(0.1);
    expect(n - s).toBeLessThan(0.1);
    expect(w).toBeLessThan(10.0);
    expect(e).toBeGreaterThan(10.06);
  });

  it("starts from the chord between the terminals", () => {
    expect(editorStartLine(ride)).toEqual([
      [ride.depLon, ride.depLat],
      [ride.arrLon, ride.arrLat],
    ]);
  });

  it("offers no save until a via point was added, then sends the whole line", async () => {
    const onSaved = vi.fn();
    setManualRoute.mockResolvedValue(ride);
    render(<FerryRouteEditor ride={ride} onSaved={onSaved} onClose={vi.fn()} />);
    expect(screen.getByTestId("ferry-route-editor-save")).toBeDisabled();
    const via: [number, number] = [(ride.depLon + ride.arrLon) / 2, ride.depLat + 0.3];
    clickSegment(0, via);
    const save = await screen.findByTestId("ferry-route-editor-save");
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(setManualRoute).toHaveBeenCalledWith(
      ride.id,
      [[ride.depLon, ride.depLat], via, [ride.arrLon, ride.arrLat]],
      ride.updatedAt,
      "pair"
    );
  });

  it("says how many crossings the line reaches, and 'this crossing only' keeps it local (GitHub #406)", async () => {
    setManualRoute.mockResolvedValue(ride);
    render(<FerryRouteEditor ride={ride} onSaved={vi.fn()} onClose={vi.fn()} />);
    const scope = await screen.findByTestId("ferry-route-scope");
    expect(scope.textContent).toContain("ferry:routeEditor.scope.pair");
    fireEvent.click(screen.getByTestId("ferry-route-only-this"));
    expect(scope.textContent).toContain("ferry:routeEditor.scope.onlyThis");
    clickSegment(0, [ride.depLon, ride.depLat + 0.2]);
    const save = await screen.findByTestId("ferry-route-editor-save");
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(setManualRoute).toHaveBeenCalled());
    expect(setManualRoute.mock.calls[0][3]).toBe("journey");
  });

  it("says so when the reach cannot be loaded instead of saving blind in silence", async () => {
    routePair.mockRejectedValue(new Error("network"));
    render(<FerryRouteEditor ride={ride} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByTestId("ferry-route-scope-failed")).toBeInTheDocument();
  });

  it("shows the server's reason for a refused line, not a raw code", async () => {
    setManualRoute.mockRejectedValue({
      response: { data: { error: "bad", code: "FERRY_ROUTE_NOT_ANCHORED" } },
    });
    render(<FerryRouteEditor ride={ride} onSaved={vi.fn()} onClose={vi.fn()} />);
    clickSegment(0, [ride.depLon, ride.depLat + 0.2]);
    const save = await screen.findByTestId("ferry-route-editor-save");
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    const alert = await screen.findByTestId("ferry-route-editor-error");
    expect(alert.textContent).toBe("ferry:routeEditor.errors.FERRY_ROUTE_NOT_ANCHORED");
  });

  it("falls back to the generic sentence for an unknown failure", async () => {
    setManualRoute.mockRejectedValue(new Error("network"));
    render(<FerryRouteEditor ride={ride} onSaved={vi.fn()} onClose={vi.fn()} />);
    clickSegment(0, [ride.depLon, ride.depLat + 0.2]);
    const save = await screen.findByTestId("ferry-route-editor-save");
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect((await screen.findByTestId("ferry-route-editor-error")).textContent).toBe(
      "ferry:routeEditor.failed"
    );
  });
});
