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

describe("TourLegList", () => {
  it("offers only 'straight' for a leg with no stored line", () => {
    const leg = makeLeg({ waypoints: null });
    render(
      <TourLegList legs={[leg]} stopTitleById={STOP_TITLES} onSetSource={vi.fn()} onClear={vi.fn()} />
    );

    const select = screen.getByRole("combobox");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["straight"]);
    expect(select).toBeDisabled();
    expect(screen.getByText("trips:tours.noLineYet")).toBeInTheDocument();
  });

  it("offers 'straight' and 'drawn' for a leg that already has waypoints", () => {
    const leg = makeLeg({
      source: "drawn",
      waypoints: [
        [8.0, 58.15],
        [5.32, 60.39],
      ],
    });
    render(
      <TourLegList legs={[leg]} stopTitleById={STOP_TITLES} onSetSource={vi.fn()} onClear={vi.fn()} />
    );

    const select = screen.getByRole("combobox");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value")).sort()).toEqual(["drawn", "straight"]);
    expect(select).not.toBeDisabled();
    expect(screen.queryByText("trips:tours.noLineYet")).not.toBeInTheDocument();
  });

  it("still treats a leg with fewer than two waypoints as having no line", () => {
    // `hasLine` requires waypoints.length >= 2 — a single stray point is
    // not a usable line, so this must fall back to the "straight only" case.
    const leg = makeLeg({ waypoints: [[8.0, 58.15]] });
    render(
      <TourLegList legs={[leg]} stopTitleById={STOP_TITLES} onSetSource={vi.fn()} onClear={vi.fn()} />
    );

    const select = screen.getByRole("combobox");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["straight"]);
    expect(select).toBeDisabled();
  });

  it("calls onSetSource with the leg and the chosen value", () => {
    const onSetSource = vi.fn();
    const leg = makeLeg({
      source: "straight",
      waypoints: [
        [8.0, 58.15],
        [5.32, 60.39],
      ],
    });
    render(
      <TourLegList legs={[leg]} stopTitleById={STOP_TITLES} onSetSource={onSetSource} onClear={vi.fn()} />
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "drawn" } });
    expect(onSetSource).toHaveBeenCalledWith(leg, "drawn");
  });

  it("disables the clear button when the leg is already straight, enables it otherwise", () => {
    const straightLeg = makeLeg({ source: "straight" });
    const { rerender } = render(
      <TourLegList legs={[straightLeg]} stopTitleById={STOP_TITLES} onSetSource={vi.fn()} onClear={vi.fn()} />
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
      <TourLegList legs={[drawnLeg]} stopTitleById={STOP_TITLES} onSetSource={vi.fn()} onClear={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "trips:tours.clearLeg" })).not.toBeDisabled();
  });

  it("shows the empty-state message when there are no legs", () => {
    render(<TourLegList legs={[]} stopTitleById={STOP_TITLES} onSetSource={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText("trips:tours.noLegs")).toBeInTheDocument();
  });
});
