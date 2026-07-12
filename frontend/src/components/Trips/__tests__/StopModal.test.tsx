import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StopModal from "../StopModal";
import { tripsApi } from "../../../lib/api";
import type { TripStop } from "../../../types";
import type { LocationCoordinates, LocationSelection } from "../../location/LocationInput";

vi.mock("../../../lib/api", () => ({
  tripsApi: {
    createStop: vi.fn(),
    updateStop: vi.fn(),
  },
}));

// Task 5's wiring focus: the LocationInput mock is FUNCTIONAL (not just
// `() => null`), mirroring Task 4's established child-picker technique
// (see LodgingFormModal.test.tsx). It renders the received `value` (to
// assert pin-seeding on edit) and a button that fires a full
// `LocationSelection` via `onChange` (to assert the payload picks up
// lat/lon and the title-fill-only-when-empty rule). The paste-split itself
// is Task 3's covered ground.
const MOCK_SELECTION: LocationSelection = {
  lat: 47.3769,
  lon: 8.5417,
  name: "Rheinfall",
};

vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    value,
    onChange,
  }: {
    value: LocationCoordinates | null;
    onChange: (selection: LocationSelection) => void;
  }) => (
    <div>
      <span data-testid="location-input-value">{value ? `${value.lat},${value.lon}` : "null"}</span>
      <button type="button" onClick={() => onChange(MOCK_SELECTION)}>
        mock-select-location
      </button>
    </div>
  ),
}));

const baseStop: TripStop = {
  id: "stop-1",
  tripId: "trip-1",
  title: "Old Title",
  domain: "poi",
  sourceId: null,
  description: null,
  startDate: null,
  endDate: null,
  lat: null,
  lon: null,
  notes: null,
  orderIdx: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("StopModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a stop with the entered title and no coords (coords stay optional)", async () => {
    vi.mocked(tripsApi.createStop).mockResolvedValue({ ...baseStop, id: "new-stop" });
    const onSaved = vi.fn();

    render(<StopModal tripId="trip-1" stop={null} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByPlaceholderText("trips:stopModal.titlePlaceholder"), {
      target: { value: "Café Central" },
    });
    await userEvent.click(screen.getByText("trips:stopModal.save"));

    await waitFor(() => expect(tripsApi.createStop).toHaveBeenCalled());
    const [, payload] = vi.mocked(tripsApi.createStop).mock.calls[0];
    expect(payload.title).toBe("Café Central");
    expect(payload.lat).toBeUndefined();
    expect(payload.lon).toBeUndefined();
    expect(onSaved).toHaveBeenCalled();
  });

  it("fills lat/lon from a LocationInput selection and prefills the empty title", async () => {
    vi.mocked(tripsApi.createStop).mockResolvedValue({ ...baseStop, id: "new-stop" });

    render(<StopModal tripId="trip-1" stop={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByText("mock-select-location"));
    await userEvent.click(screen.getByText("trips:stopModal.save"));

    await waitFor(() => expect(tripsApi.createStop).toHaveBeenCalled());
    const [, payload] = vi.mocked(tripsApi.createStop).mock.calls[0];
    expect(payload.lat).toBe(47.3769);
    expect(payload.lon).toBe(8.5417);
    expect(payload.title).toBe("Rheinfall");
  });

  it("does not overwrite an already-typed title when a selection also carries a name", async () => {
    vi.mocked(tripsApi.createStop).mockResolvedValue({ ...baseStop, id: "new-stop" });

    render(<StopModal tripId="trip-1" stop={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("trips:stopModal.titlePlaceholder"), {
      target: { value: "My Own Title" },
    });
    await userEvent.click(screen.getByText("mock-select-location"));
    await userEvent.click(screen.getByText("trips:stopModal.save"));

    await waitFor(() => expect(tripsApi.createStop).toHaveBeenCalled());
    const [, payload] = vi.mocked(tripsApi.createStop).mock.calls[0];
    expect(payload.title).toBe("My Own Title");
  });

  it("seeds the LocationInput pin from the stored stop coordinates on edit", () => {
    render(
      <StopModal
        tripId="trip-1"
        stop={{ ...baseStop, lat: 52.516, lon: 13.3777 }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByTestId("location-input-value")).toHaveTextContent("52.516,13.3777");
  });

  it("clears the pin via the clear affordance and sends explicit null coords on update", async () => {
    vi.mocked(tripsApi.updateStop).mockResolvedValue({ ...baseStop, lat: null, lon: null });

    render(
      <StopModal
        tripId="trip-1"
        stop={{ ...baseStop, lat: 52.516, lon: 13.3777 }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const clearButton = screen.getByText("location:clear");
    await userEvent.click(clearButton);

    expect(screen.getByTestId("location-input-value")).toHaveTextContent("null");
    expect(screen.queryByText("location:clear")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("trips:stopModal.save"));

    await waitFor(() => expect(tripsApi.updateStop).toHaveBeenCalled());
    const [, , payload] = vi.mocked(tripsApi.updateStop).mock.calls[0];
    expect(payload.lat).toBeNull();
    expect(payload.lon).toBeNull();
  });

  it("updates a stop, carrying the seeded coords through unchanged when no selection is made", async () => {
    vi.mocked(tripsApi.updateStop).mockResolvedValue({ ...baseStop, lat: 52.516, lon: 13.3777 });

    render(
      <StopModal
        tripId="trip-1"
        stop={{ ...baseStop, lat: 52.516, lon: 13.3777 }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await userEvent.click(screen.getByText("trips:stopModal.save"));

    await waitFor(() => expect(tripsApi.updateStop).toHaveBeenCalled());
    const [, , payload] = vi.mocked(tripsApi.updateStop).mock.calls[0];
    expect(payload.lat).toBe(52.516);
    expect(payload.lon).toBe(13.3777);
  });
});
