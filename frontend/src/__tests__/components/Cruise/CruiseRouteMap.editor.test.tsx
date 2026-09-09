import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
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
   * The editor first opened by rendering the map a second time inside a dialog
   * frame — a different place in the tree, which is an unmount plus a mount.
   * maplibre threw its WebGL context away and deck.gl's overlay met the new
   * one with every layer failing to initialise ("deck.gl: assertion failed"):
   * the editor opened onto a bare basemap with no route on it. Gating the
   * overlay on a freshly reset "loaded" flag papered over it in the dev server
   * and did NOT hold in a production build — it shipped to an RC that way.
   *
   * So the contract is not "re-attach correctly". It is: the map does not move.
   * One mount for the life of the component, whichever appearance it wears.
   */
  it("does not rebuild the map when the editor opens", async () => {
    render(<CruiseRouteMap cruise={cruise} />);
    expect(pendingLoads).toHaveLength(1);
    flushPendingLoads();
    await waitFor(() => expect(useControlSpy).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "cruise:routeEditor.edit" }));
    await screen.findByRole("dialog");

    // A second mount would have registered a second onLoad.
    expect(pendingLoads).toHaveLength(0);
    expect(screen.getAllByTestId("map-instance")).toHaveLength(1);
  });

  it("does not rebuild the map when the editor closes either", async () => {
    render(<CruiseRouteMap cruise={cruise} />);
    flushPendingLoads();

    fireEvent.click(screen.getByRole("button", { name: "cruise:routeEditor.edit" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(pendingLoads).toHaveLength(0);
    expect(screen.getAllByTestId("map-instance")).toHaveLength(1);
  });

  it("returns the map to the page card when the editor is dismissed", async () => {
    render(<CruiseRouteMap cruise={cruise} />);
    flushPendingLoads();

    fireEvent.click(screen.getByRole("button", { name: "cruise:routeEditor.edit" }));
    const dialog = await screen.findByRole("dialog");

    // Two controls dismiss the editor — the ✕ in the header and the action
    // row's Cancel. The action row is the one a mouse user reaches for.
    const dismiss = within(dialog).getAllByRole("button", {
      name: "cruise:routeEditor.cancel",
    });
    fireEvent.click(dismiss[dismiss.length - 1]);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getAllByTestId("map-instance")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "cruise:routeEditor.edit" })).toBeTruthy();
  });
});
