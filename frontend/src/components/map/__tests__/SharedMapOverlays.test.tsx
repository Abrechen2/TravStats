import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  isStyleLoaded: vi.fn(() => true),
  apply: vi.fn(),
}));
vi.mock("react-map-gl/maplibre", () => ({ useMap: () => ({ current: { getMap: () => mock } }) }));
vi.mock("../../Globe/mapOverlays", () => ({ applyMapOverlays: mock.apply }));
import { SharedMapOverlays } from "../SharedMapOverlays";
import { saveMapAppearance } from "../mapAppearance";
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
it("reapplies shared label/relief settings after a style reload and removes listeners", () => {
  const view = render(<SharedMapOverlays />);
  expect(mock.apply).toHaveBeenLastCalledWith(mock, { showTerrain: false, showPlaceLabels: true });
  act(() => saveMapAppearance({ showTerrain: true, showPlaceLabels: false }));
  expect(mock.apply).toHaveBeenLastCalledWith(mock, { showTerrain: true, showPlaceLabels: false });
  const listener = mock.on.mock.calls[mock.on.mock.calls.length - 1][1];
  mock.apply.mockClear();
  listener();
  expect(mock.apply).toHaveBeenCalledWith(mock, { showTerrain: true, showPlaceLabels: false });
  view.unmount();
  expect(mock.off).toHaveBeenCalledWith("style.load", listener);
});
