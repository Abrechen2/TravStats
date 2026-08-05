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

  // #175: "Currently there is only a date field. And so there is no chance to
  // order more POIs on the same day correct."
  it("sends the entered time as part of the stop's start date", async () => {
    vi.mocked(tripsApi.createStop).mockResolvedValue({ ...baseStop, id: "new-stop" });

    render(<StopModal tripId="trip-1" stop={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("trips:stopModal.titlePlaceholder"), {
      target: { value: "Louvre" },
    });
    fireEvent.change(screen.getByLabelText("trips:stopModal.startDateLabel"), {
      target: { value: "2026-05-01" },
    });
    fireEvent.change(screen.getByLabelText("trips:stopModal.startTimeLabel"), {
      target: { value: "14:30" },
    });
    await userEvent.click(screen.getByText("trips:stopModal.save"));

    await waitFor(() => expect(tripsApi.createStop).toHaveBeenCalled());
    // The wall clock the user typed, pinned to UTC so it round-trips for every
    // viewer — see the time model in lib/tripTimeline.ts.
    expect(vi.mocked(tripsApi.createStop).mock.calls[0][1].startDate).toBe(
      "2026-05-01T14:30:00.000Z"
    );
  });

  it("keeps a stop date-only when no time is entered", async () => {
    vi.mocked(tripsApi.createStop).mockResolvedValue({ ...baseStop, id: "new-stop" });

    render(<StopModal tripId="trip-1" stop={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("trips:stopModal.titlePlaceholder"), {
      target: { value: "Irgendwo" },
    });
    fireEvent.change(screen.getByLabelText("trips:stopModal.startDateLabel"), {
      target: { value: "2026-05-01" },
    });
    await userEvent.click(screen.getByText("trips:stopModal.save"));

    await waitFor(() => expect(tripsApi.createStop).toHaveBeenCalled());
    // Midnight UTC is the date-only convention; the time field must not be
    // mandatory just because it now exists.
    expect(vi.mocked(tripsApi.createStop).mock.calls[0][1].startDate).toBe(
      "2026-05-01T00:00:00.000Z"
    );
  });

  it("seeds both fields from a stored time and round-trips it unchanged", async () => {
    vi.mocked(tripsApi.updateStop).mockResolvedValue({ ...baseStop });

    render(
      <StopModal
        tripId="trip-1"
        stop={{ ...baseStop, startDate: "2026-05-01T09:15:00.000Z" }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(
      (screen.getByLabelText("trips:stopModal.startDateLabel") as HTMLInputElement).value
    ).toBe("2026-05-01");
    expect(
      (screen.getByLabelText("trips:stopModal.startTimeLabel") as HTMLInputElement).value
    ).toBe("09:15");

    // Saving without touching anything must not shift the time.
    await userEvent.click(screen.getByText("trips:stopModal.save"));
    await waitFor(() => expect(tripsApi.updateStop).toHaveBeenCalled());
    expect(vi.mocked(tripsApi.updateStop).mock.calls[0][2].startDate).toBe(
      "2026-05-01T09:15:00.000Z"
    );
  });

  it("shows an empty time field for a stored date-only stop, not 00:00", async () => {
    render(
      <StopModal
        tripId="trip-1"
        stop={{ ...baseStop, startDate: "2026-05-01T00:00:00.000Z" }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(
      (screen.getByLabelText("trips:stopModal.startTimeLabel") as HTMLInputElement).value
    ).toBe("");
  });
});
