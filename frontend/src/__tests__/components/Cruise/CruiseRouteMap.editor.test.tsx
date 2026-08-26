import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { JSX, ReactNode } from "react";

/**
 * Every `<MapGL>` mount pushes its `onLoad` here instead of firing it. A real
 * map reports "loaded" one frame after it mounts; a mock that fires on mount
 * would hide exactly the window this test is about.
 */
const pendingLoads: (() => void)[] = [];
const useControlSpy = vi.fn();

vi.mock("react-map-gl/maplibre", async () => {
  const { useEffect } = await import("react");
  // Named like a component because it IS one — the lint rule that spots
  // hooks outside components has no other way to know.
  const MapStub = ({
    children,
    onLoad,
  }: {
    children?: ReactNode;
    onLoad?: () => void;
  }): JSX.Element => {
    // Registered on MOUNT, not on every render: one map instance reports
    // "loaded" exactly once, and the count of pending loads is what tells
    // this test that a NEW map was built.
    useEffect(() => {
      if (onLoad) pendingLoads.push(onLoad);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
    }, []);
    return <div data-testid="map-instance">{children}</div>;
  };

  return {
    default: MapStub,
    useControl: (factory: () => unknown) => {
      useControlSpy();
      return factory();
    },
    Marker: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@deck.gl/mapbox", () => ({
  MapboxOverlay: class {
    setProps(): void {}
  },
}));

vi.mock("../../../lib/api/cruise", () => ({
  cruiseApi: {
    getGeometry: vi.fn().mockResolvedValue({ type: "FeatureCollection", features: [] }),
  },
}));

import { CruiseRouteMap } from "../../../components/Cruise/CruiseRouteMap";
import type { Cruise } from "../../../types";

const cruise = {
  id: "c1",
  stops: [],
  departurePort: null,
  arrivalPort: null,
} as unknown as Cruise;

const flushPendingLoads = (): void => {
  const due = pendingLoads.splice(0, pendingLoads.length);
  act(() => {
    for (const load of due) load();
  });
};

beforeEach(() => {
  pendingLoads.length = 0;
  useControlSpy.mockClear();
});

describe("CruiseRouteMap — the route editor is a dialog", () => {
  it("opens a dialog when the edit button is pressed", async () => {
    render(<CruiseRouteMap cruise={cruise} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "cruise:routeEditor.edit" }));

    const dialog = await screen.findByRole("dialog");
    // The map moves INTO the dialog — a second one would mean two WebGL
    // contexts drawing the same route.
    expect(dialog.querySelector("[data-testid='map-instance']")).not.toBeNull();
    expect(screen.getAllByTestId("map-instance")).toHaveLength(1);
  });

  /**
   * The regression this file exists for.
   *
   * Moving the map into the dialog destroys one maplibre instance and builds
   * another. `mapLoaded` gates the deck.gl overlay; left true from the map
   * that just went away, the overlay attached to a map that had not loaded
   * its style yet and every layer died with "deck.gl: assertion failed" — a
   * dialog with a basemap and no route on it, which is what the owner saw.
   */
  it("waits for the NEW map to load before attaching the deck overlay", async () => {
    render(<CruiseRouteMap cruise={cruise} />);
    expect(useControlSpy).not.toHaveBeenCalled();

    flushPendingLoads();
    await waitFor(() => expect(useControlSpy).toHaveBeenCalled());

    const attachedToTheCardMap = useControlSpy.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "cruise:routeEditor.edit" }));
    await screen.findByRole("dialog");

    // The dialog's map has mounted but has not reported load yet.
    expect(pendingLoads).toHaveLength(1);
    expect(useControlSpy.mock.calls.length).toBe(attachedToTheCardMap);

    flushPendingLoads();
    await waitFor(() =>
      expect(useControlSpy.mock.calls.length).toBeGreaterThan(attachedToTheCardMap)
    );
  });

  it("returns the map to the page card when the dialog is dismissed", async () => {
    render(<CruiseRouteMap cruise={cruise} />);
    flushPendingLoads();

    fireEvent.click(screen.getByRole("button", { name: "cruise:routeEditor.edit" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(
      dialog.querySelector("button[type='button']:last-of-type") as HTMLButtonElement
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getAllByTestId("map-instance")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "cruise:routeEditor.edit" })).toBeTruthy();
  });
});
