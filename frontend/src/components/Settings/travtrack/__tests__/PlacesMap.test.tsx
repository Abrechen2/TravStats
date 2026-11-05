import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
  }),
}));
vi.mock("../../../../hooks/useTravTrackVisible", () => ({
  useTravTrackCapabilities: () => ({
    version: 1,
    offered: true,
    enabled: true,
    active: true,
    hasData: true,
  }),
}));
vi.mock("../../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
const glAvailable = vi.hoisted(() => ({ ok: true }));
// jsdom has no WebGL: the guard is replaced by the answer under test; the map by a stub of its props.
vi.mock("../../../map/WebGLGuard", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    glAvailable.ok ? <>{children}</> : <p role="alert">no-webgl</p>,
}));
vi.mock("../PlacesMap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../PlacesMap")>()),
  default: (props: {
    places: Array<{ id: string }>;
    zones: Array<{ id: string }>;
    onPick?: (id: string) => void;
  }) => (
    <div data-testid="places-map">
      {props.places.length} places, {props.zones.length} zones
      <button onClick={() => props.onPick?.("w1")}>pick-w1</button>
    </div>
  ),
}));

import TravTrackPlacesSection from "../TravTrackPlacesSection";
import { circlePath, placeLayers, type MappedPlace } from "../PlacesMap";
import { travTrackPlacesApi, type FixedPlacesAnswer } from "../../../../lib/api/travtrackPlaces";
import { travTrackApi } from "../../../../lib/api/travtrack";
import { resetWriteQueue } from "../../../ui/settings/writeQueue";

const place = (id: string, kind: "home" | "work", lat: number | null) => ({
  id,
  name: id,
  kind,
  lat,
  lon: lat === null ? null : 9.2,
  radiusM: 200,
  window: null,
});
const answer = (places: FixedPlacesAnswer["places"]): FixedPlacesAnswer => ({
  places,
  lodgingAsPlace: { enabled: false, radiusM: 150 },
});
const show = () =>
  render(
    <MemoryRouter>
      <TravTrackPlacesSection />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.restoreAllMocks();
  glAvailable.ok = true;
  vi.spyOn(travTrackPlacesApi, "list").mockResolvedValue(
    answer([place("home", "home", 48.78), place("w1", "work", 48.8)])
  );
  vi.spyOn(travTrackApi, "zones").mockResolvedValue([
    { id: "z1", name: "Eltern", lat: 48.9, lon: 9.3, radiusM: 300 },
  ]);
});
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
});

describe("Feste Orte map", () => {
  it("draws the places and the privacy zones beside the list", async () => {
    show();
    expect(await screen.findByTestId("places-map")).toHaveTextContent("2 places, 1 zones");
    expect(screen.getByTestId("place-w1")).toBeInTheDocument();
  });

  it("clicking a circle opens that place's editor", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: "pick-w1" }));
    expect(
      await screen.findByLabelText("settings:tt.places.editor.name", {}, { timeout: 2000 })
    ).toBeInTheDocument();
  });

  it("without WebGL the list still works and a notice replaces the map", async () => {
    glAvailable.ok = false;
    show();
    expect(await screen.findByTestId("place-w1")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("no-webgl");
    expect(screen.queryByTestId("places-map")).toBeNull();
  });

  it("a home without a residence has no position and no circle", async () => {
    vi.spyOn(travTrackPlacesApi, "list").mockResolvedValue(answer([place("home", "home", null)]));
    show();
    expect(await screen.findByTestId("place-home")).toBeInTheDocument();
    expect(screen.queryByTestId("places-map")).toBeNull();
  });

  it("a zones read that fails leaves the map without outlines, not the page without a list", async () => {
    vi.spyOn(travTrackApi, "zones").mockRejectedValue(new Error("500"));
    show();
    expect(await screen.findByTestId("places-map")).toHaveTextContent("2 places, 0 zones");
  });
});

describe("placeLayers", () => {
  it("colours circles by kind, outlines zones dashed and only picks when editing is allowed", () => {
    const places: MappedPlace[] = [{ ...place("w1", "work", 48.8), lat: 48.8, lon: 9.2 }];
    const layers = placeLayers(
      places,
      [{ id: "z", name: "z", lat: 1, lon: 2, radiusM: 100 }],
      true
    );
    expect(layers.map((l) => l.id)).toEqual(["place-circles", "zone-outlines"]);
    expect(layers[0].props.pickable).toBe(true);
    expect(placeLayers(places, [], false)[0].props.pickable).toBe(false);
  });

  it("circlePath closes its ring at the radius", () => {
    const ring = circlePath(9, 48, 1000);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(Math.abs(ring[0][0] - 9)).toBeGreaterThan(0.01);
  });
});

describe("Feste Orte map follows the zones section", () => {
  it("re-reads the zones when one was added or removed elsewhere on the page", async () => {
    const zones = vi.spyOn(travTrackApi, "zones");
    show();
    expect(await screen.findByTestId("places-map")).toHaveTextContent("1 zones");
    zones.mockResolvedValue([]);
    act(() => {
      window.dispatchEvent(new Event("travtrack:zones-changed"));
    });
    await waitFor(() => expect(screen.getByTestId("places-map")).toHaveTextContent("0 zones"));
  });
});
