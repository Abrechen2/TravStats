import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../CompanionPicker", () => ({ default: () => null }));
// The geocoder field stands in as one button per station that "picks" a hit.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    label,
    onChange,
  }: {
    label: string;
    onChange: (s: { lat: number; lon: number; name?: string; countryCode?: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange(
          label === "rail:form.departureStation"
            ? { lat: 50.1071, lon: 8.6632, name: "Frankfurt (Main) Hbf", countryCode: "de" }
            : { lat: 48.8768, lon: 2.3591, name: "Paris Est", countryCode: "fr" }
        )
      }
    >
      pick {label}
    </button>
  ),
}));

const getAllTrips = vi.fn();
vi.mock("../../../lib/api", () => ({
  tripsApi: { getAll: (...a: unknown[]) => getAllTrips(...a) },
}));
const create = vi.fn();
const update = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: {
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
  },
}));

import { RailFormModal } from "../RailFormModal";

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "rail:form.save" });
}

describe("RailFormModal", () => {
  beforeEach(() => {
    create.mockReset();
    update.mockReset();
    getAllTrips.mockReset();
    getAllTrips.mockResolvedValue([{ id: "t1", name: "Paris weekend" }]);
  });

  it("will not save until both stations have a position and the train has a departure", async () => {
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(getAllTrips).toHaveBeenCalled());
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("rail:form.stationMissing")).toBeInTheDocument();

    fireEvent.click(screen.getByText("pick rail:form.departureStation"));
    fireEvent.click(screen.getByText("pick rail:form.arrivalStation"));
    expect(screen.queryByText("rail:form.stationMissing")).toBeNull();
    expect(saveButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("rail:form.departureTime"), {
      target: { value: "2026-07-01T08:15" },
    });
    expect(saveButton()).not.toBeDisabled();
  });

  it("sends the station's wall clock, the picked stations and the trip", async () => {
    const saved = { id: "new" };
    create.mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={onSaved} />);
    await screen.findByRole("option", { name: "Paris weekend" });

    fireEvent.click(screen.getByText("pick rail:form.departureStation"));
    fireEvent.click(screen.getByText("pick rail:form.arrivalStation"));
    fireEvent.change(screen.getByLabelText("rail:form.departureTime"), {
      target: { value: "2026-07-01T08:15" },
    });
    fireEvent.change(screen.getByLabelText("rail:form.category"), { target: { value: "ICE" } });
    fireEvent.change(screen.getByLabelText("rail:form.trip"), { target: { value: "t1" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        trainCategory: "ICE",
        departureLocal: "2026-07-01T08:15",
        arrivalLocal: null,
        departureStation: {
          name: "Frankfurt (Main) Hbf",
          lat: 50.1071,
          lon: 8.6632,
          country: "DE",
        },
        arrivalStation: { name: "Paris Est", lat: 48.8768, lon: 2.3591, country: "FR" },
        tripId: "t1",
        status: "scheduled",
      })
    );
  });

  it("shows the server's refusal instead of closing", async () => {
    create.mockRejectedValue({
      response: { data: { error: "arrival must not precede departure" } },
    });
    const onSaved = vi.fn();
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByText("pick rail:form.departureStation"));
    fireEvent.click(screen.getByText("pick rail:form.arrivalStation"));
    fireEvent.change(screen.getByLabelText("rail:form.departureTime"), {
      target: { value: "2026-07-01T08:15" },
    });
    fireEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "arrival must not precede departure"
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});
