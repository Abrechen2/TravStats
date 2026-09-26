import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import LegDialog from "../LegDialog";
import { toursApi } from "../../../lib/api/tours";
import type { TourLeg } from "../../../types/tour";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/tours", () => ({
  toursApi: {
    setLeg: vi.fn(async () => ({})),
    routeLeg: vi.fn(async () => ({ leg: {}, fallbackReason: null })),
  },
}));

const LEG: TourLeg = {
  id: "leg",
  fromStopId: "a",
  toStopId: "b",
  distanceKm: 32,
  source: "straight",
  mode: "road",
  confidence: "estimate",
  waypoints: null,
  drivingMinutes: null,
  tollCost: null,
  currency: null,
};

function renderDialog(
  routingAvailable = true,
  onSaved = vi.fn(),
  leg: TourLeg = LEG
): ReturnType<typeof vi.fn> {
  render(
    <MemoryRouter>
      <LegDialog
        routeId="rt"
        leg={leg}
        from={{ id: "a", title: "Gudvangen" }}
        to={{ id: "b", title: "Kaupanger" }}
        routingAvailable={routingAvailable}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    </MemoryRouter>
  );
  return onSaved;
}

describe("LegDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers no road routing for a ferry, and saves the ferry as a straight crossing", async () => {
    const onSaved = renderDialog();
    fireEvent.click(screen.getByText("roadtrips:timeline.leg.ferry"));
    expect(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ })).toBeDisabled();
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(toursApi.setLeg).toHaveBeenCalledWith(undefined, "rt", "a", "b", {
      source: "straight",
      mode: "ferry",
    });
    expect(toursApi.routeLeg).not.toHaveBeenCalled();
  });

  it("routes a road leg along the road when asked", async () => {
    const onSaved = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ }));
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(toursApi.routeLeg).toHaveBeenCalledWith(undefined, "rt", "a", "b");
  });

  it("stays open and says why when the provider could not route the leg", async () => {
    vi.mocked(toursApi.routeLeg).mockResolvedValueOnce({
      leg: LEG,
      fallbackReason: "point_not_near_road",
    });
    const onSaved = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ }));
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));

    expect(await screen.findByText("roadtrips:legDialog.fallback")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:legDialog.fallbackKept")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does not flatten a drawn leg to a straight line before trying to route it", async () => {
    vi.mocked(toursApi.routeLeg).mockResolvedValueOnce({ leg: LEG, fallbackReason: "no_route" });
    renderDialog(true, vi.fn(), {
      ...LEG,
      source: "drawn",
      waypoints: [
        [6.8, 60.9],
        [7.2, 61.2],
      ],
    });
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ }));
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));

    await screen.findByText("roadtrips:legDialog.fallback");
    expect(toursApi.setLeg).not.toHaveBeenCalled();
  });

  it("saves a straight line when the reader picks one", async () => {
    const onSaved = renderDialog(true, vi.fn(), { ...LEG, source: "drawn" });
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.straight/ }));
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(toursApi.setLeg).toHaveBeenCalledWith(undefined, "rt", "a", "b", {
      source: "straight",
      mode: "road",
    });
    expect(toursApi.routeLeg).not.toHaveBeenCalled();
  });

  it("says why there is no routing when the instance has no provider", () => {
    renderDialog(false);
    expect(screen.getByText("roadtrips:legDialog.routedUnavailable")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ })).toBeDisabled();
  });
});
