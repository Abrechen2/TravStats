import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import TourLegList from "../TourLegList";
import type { TourLeg } from "../../../types/tour";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const STOP_TITLES = new Map([
  ["a", "Kristiansand"],
  ["b", "Bergen"],
  ["c", "Oslo"],
]);

function makeLeg(overrides: Partial<TourLeg>): TourLeg {
  return {
    id: "leg-1",
    fromStopId: "a",
    toStopId: "b",
    distanceKm: 340,
    source: "straight",
    mode: "road",
    confidence: "low",
    waypoints: null,
    drivingMinutes: null,
    tollCost: null,
    currency: null,
    ...overrides,
  };
}

interface RenderOverrides {
  routingAvailable?: boolean;
  onSetSource?: (leg: TourLeg, source: "straight" | "drawn") => void;
  onRoute?: (leg: TourLeg) => void;
  onClear?: (leg: TourLeg) => void;
  onRouteAll?: () => void;
  routingAllInProgress?: boolean;
}

function renderList(legs: TourLeg[], overrides: RenderOverrides = {}) {
  const props = {
    routingAvailable: false,
    onSetSource: vi.fn(),
    onRoute: vi.fn(),
    onClear: vi.fn(),
    onRouteAll: vi.fn(),
    ...overrides,
  };
  render(<TourLegList legs={legs} stopTitleById={STOP_TITLES} {...props} />);
  return props;
}

describe("TourLegList", () => {
  it("offers 'straight' and a disabled 'routed' for a routable leg with no stored line when routing is unavailable", () => {
    const leg = makeLeg({ waypoints: null, mode: "road" });
    renderList([leg], { routingAvailable: false });

    const select = screen.getByRole("combobox");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["straight", "routed"]);
    expect(options.find((o) => o.getAttribute("value") === "routed")).toBeDisabled();
    // Only one enabled option ("straight") — the select as a whole has
    // nothing to switch to, same rule as before "routed" existed.
    expect(select).toBeDisabled();
    expect(screen.getByText("trips:tours.noLineYet")).toBeInTheDocument();
    expect(screen.getByText("trips:tours.routing.unavailableReason")).toBeInTheDocument();
  });

  it("offers 'straight', 'drawn', and a disabled 'routed' for a leg with waypoints when routing is unavailable", () => {
    const leg = makeLeg({
      source: "drawn",
      mode: "road",
      waypoints: [
        [8.0, 58.15],
        [5.32, 60.39],
      ],
    });
    renderList([leg], { routingAvailable: false });

    const select = screen.getByRole("combobox");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value")).sort()).toEqual([
      "drawn",
      "routed",
      "straight",
    ]);
    expect(options.find((o) => o.getAttribute("value") === "routed")).toBeDisabled();
    // Two functional options ("straight", "drawn") — the select stays usable.
    expect(select).not.toBeDisabled();
    expect(screen.queryByText("trips:tours.noLineYet")).not.toBeInTheDocument();
    expect(screen.getByText("trips:tours.routing.unavailableReason")).toBeInTheDocument();
  });

  it("still treats a leg with fewer than two waypoints as having no line", () => {
    // `hasLine` requires waypoints.length >= 2 — a single stray point is
    // not a usable line, so this must fall back to the "straight only" case.
    const leg = makeLeg({ waypoints: [[8.0, 58.15]], mode: "road" });
    renderList([leg], { routingAvailable: false });

    const select = screen.getByRole("combobox");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["straight", "routed"]);
    expect(select).toBeDisabled();
  });

  it("enables 'routed' (and does not show the unavailable reason) once a provider is configured", () => {
    const leg = makeLeg({ waypoints: null, mode: "road" });
    renderList([leg], { routingAvailable: true });

    const select = screen.getByRole("combobox");
    const options = within(select).getAllByRole("option");
    expect(options.find((o) => o.getAttribute("value") === "routed")).not.toBeDisabled();
    // "straight" + "routed" are both functional now.
    expect(select).not.toBeDisabled();
    expect(screen.queryByText("trips:tours.routing.unavailableReason")).not.toBeInTheDocument();
  });

  it("never offers 'routed' for a non-routable leg mode, even when routing is available", () => {
    const ferryLeg = makeLeg({ mode: "ferry", waypoints: null });
    renderList([ferryLeg], { routingAvailable: true });

    const select = screen.getByRole("combobox");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["straight"]);
    expect(screen.queryByText("trips:tours.routing.unavailableReason")).not.toBeInTheDocument();
  });

  it("calls onSetSource (not onRoute) with the leg and the chosen manual value", () => {
    const leg = makeLeg({
      source: "straight",
      mode: "road",
      waypoints: [
        [8.0, 58.15],
        [5.32, 60.39],
      ],
    });
    const props = renderList([leg], { routingAvailable: true });

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "drawn" } });
    expect(props.onSetSource).toHaveBeenCalledWith(leg, "drawn");
    expect(props.onRoute).not.toHaveBeenCalled();
  });

  it("calls onRoute (not onSetSource) when 'routed' is selected", () => {
    const leg = makeLeg({ source: "straight", mode: "road", waypoints: null });
    const props = renderList([leg], { routingAvailable: true });

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "routed" } });
    expect(props.onRoute).toHaveBeenCalledWith(leg);
    expect(props.onSetSource).not.toHaveBeenCalled();
  });

  it("disables the clear button when the leg is already straight, enables it otherwise", () => {
    const straightLeg = makeLeg({ source: "straight" });
    const { rerender } = render(
      <TourLegList
        legs={[straightLeg]}
        stopTitleById={STOP_TITLES}
        routingAvailable={false}
        onSetSource={vi.fn()}
        onRoute={vi.fn()}
        onClear={vi.fn()}
        onRouteAll={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "trips:tours.clearLeg" })).toBeDisabled();

    const drawnLeg = makeLeg({
      source: "drawn",
      waypoints: [
        [8.0, 58.15],
        [5.32, 60.39],
      ],
    });
    rerender(
      <TourLegList
        legs={[drawnLeg]}
        stopTitleById={STOP_TITLES}
        routingAvailable={false}
        onSetSource={vi.fn()}
        onRoute={vi.fn()}
        onClear={vi.fn()}
        onRouteAll={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "trips:tours.clearLeg" })).not.toBeDisabled();
  });

  it("shows the empty-state message when there are no legs, without a 'route all' button", () => {
    renderList([]);
    expect(screen.getByText("trips:tours.noLegs")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "trips:tours.routing.routeAll" })
    ).not.toBeInTheDocument();
  });

  it("calls onRouteAll when the 'route the whole section' button is clicked", () => {
    const leg = makeLeg({});
    const props = renderList([leg]);

    fireEvent.click(screen.getByRole("button", { name: "trips:tours.routing.routeAll" }));
    expect(props.onRouteAll).toHaveBeenCalledTimes(1);
  });

  it("shows a busy label and disables the 'route all' button while a batch request is in flight", () => {
    const leg = makeLeg({});
    renderList([leg], { routingAllInProgress: true });

    const button = screen.getByRole("button", { name: "trips:tours.routing.routingAll" });
    expect(button).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "trips:tours.routing.routeAll" })
    ).not.toBeInTheDocument();
  });
});
