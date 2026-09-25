import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import NewRoadtripDialog from "../NewRoadtripDialog";
import { roadtripsApi } from "../../../lib/api/roadtrips";

vi.mock("../../../lib/api/roadtrips", () => ({ roadtripsApi: { create: vi.fn() } }));
vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn(async () => [{ id: "t1", name: "Herbst in Norwegen" }]) },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function renderDialog(onCreated = vi.fn()): ReturnType<typeof vi.fn> {
  render(<NewRoadtripDialog open onClose={vi.fn()} onCreated={onCreated} />);
  return onCreated;
}

describe("NewRoadtripDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers no rail — train journeys are a domain of their own (owner, 2026-09-25)", async () => {
    renderDialog();
    await screen.findByText("Herbst in Norwegen");
    expect(screen.getByText("roadtrips:vehicle.campervan")).toBeInTheDocument();
    expect(screen.queryByText("roadtrips:vehicle.rail")).not.toBeInTheDocument();
  });

  it("needs only a name, and sends what was filled in", async () => {
    vi.mocked(roadtripsApi.create).mockResolvedValue({ id: "new" } as never);
    const onCreated = renderDialog();
    const submit = screen.getByText("roadtrips:newDialog.submit").closest("button")!;
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("roadtrips:newDialog.name"), {
      target: { value: "Fjorde 2026" },
    });
    fireEvent.click(screen.getByText("roadtrips:vehicle.campervan"));
    fireEvent.change(screen.getByLabelText(/roadtrips:newDialog.odometer/), {
      target: { value: "84 210" },
    });
    await screen.findByText("Herbst in Norwegen");
    fireEvent.change(screen.getByLabelText(/roadtrips:newDialog.trip/), {
      target: { value: "t1" },
    });
    fireEvent.click(submit);

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(roadtripsApi.create).toHaveBeenCalledWith({
      name: "Fjorde 2026",
      vehicle: "campervan",
      vehicleName: null,
      tripId: "t1",
      startOdometerKm: 84210,
    });
  });

  it("holds back an odometer that is not a whole number of kilometres", async () => {
    renderDialog();
    await screen.findByText("Herbst in Norwegen");
    fireEvent.change(screen.getByLabelText("roadtrips:newDialog.name"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/roadtrips:newDialog.odometer/), {
      target: { value: "12,5" },
    });
    expect(screen.getByText("roadtrips:newDialog.submit").closest("button")).toBeDisabled();
  });
});
