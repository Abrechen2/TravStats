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
  toursApi: { setLeg: vi.fn(async () => ({})), routeLeg: vi.fn(async () => ({})) },
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

function renderDialog(routingAvailable = true, onSaved = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <MemoryRouter>
      <LegDialog
        routeId="rt"
        leg={LEG}
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

  it("says why there is no routing when the instance has no provider", () => {
    renderDialog(false);
    expect(screen.getByText("roadtrips:legDialog.routedUnavailable")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ })).toBeDisabled();
  });
});
