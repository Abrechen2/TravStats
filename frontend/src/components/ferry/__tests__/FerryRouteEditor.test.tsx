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
vi.mock("../../../lib/api/ferry", () => ({ ferryApi: { setManualRoute } }));

import { FerryRouteEditor, editorStartLine } from "../FerryRouteEditor";

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
    expect(setManualRoute).toHaveBeenCalledWith(ride.id, [
      [ride.depLon, ride.depLat],
      via,
      [ride.arrLon, ride.arrLat],
    ]);
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
