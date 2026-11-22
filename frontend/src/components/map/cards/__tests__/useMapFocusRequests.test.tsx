import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useMapFocusRequests, FOCUS_REQUEST } from "../useMapFocusRequests";
import { useMapFocusStore } from "../../../../store/mapFocusStore";

function fakeMap(zoom = 3) {
  return { getZoom: () => zoom, flyTo: vi.fn(), fitBounds: vi.fn() };
}

function Host({ map, engine }: { map: ReturnType<typeof fakeMap>; engine: "flat" | "globe" }) {
  useMapFocusRequests({ current: { getMap: () => map } }, engine);
  return null;
}

describe("useMapFocusRequests", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fits a route's bounds with the list's width left clear", () => {
    const map = fakeMap();
    render(<Host map={map} engine="flat" />);
    act(() => useMapFocusStore.getState().focus({ bbox: [7, 46, 9, 48], leftInset: 320 }));
    act(() => void vi.runAllTimers());
    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [7, 46],
        [9, 48],
      ],
      expect.objectContaining({
        padding: { top: 80, bottom: 80, left: 400, right: 80 },
        maxZoom: FOCUS_REQUEST.flat.maxZoom,
      })
    );
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it("zooms to a single point, never zooming out from a closer view", () => {
    const far = fakeMap(2);
    const { unmount } = render(<Host map={far} engine="flat" />);
    act(() => useMapFocusStore.getState().focus({ point: { lat: 38.7, lon: -9.1 } }));
    act(() => void vi.runAllTimers());
    expect(far.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-9.1, 38.7], zoom: FOCUS_REQUEST.flat.pointZoom })
    );
    unmount();

    const close = fakeMap(14);
    render(<Host map={close} engine="flat" />);
    act(() => useMapFocusStore.getState().focus({ point: { lat: 38.7, lon: -9.1 } }));
    act(() => void vi.runAllTimers());
    expect(close.flyTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 14 }));
  });

  it("ignores a request made before this map mounted", () => {
    useMapFocusStore.getState().focus({ point: { lat: 1, lon: 1 } });
    const map = fakeMap();
    render(<Host map={map} engine="globe" />);
    act(() => void vi.runAllTimers());
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("flies again when the same place is asked for twice", () => {
    const map = fakeMap();
    render(<Host map={map} engine="globe" />);
    for (let i = 0; i < 2; i++) {
      act(() => useMapFocusStore.getState().focus({ point: { lat: 1, lon: 1 } }));
      act(() => void vi.runAllTimers());
    }
    expect(map.flyTo).toHaveBeenCalledTimes(2);
  });
});
