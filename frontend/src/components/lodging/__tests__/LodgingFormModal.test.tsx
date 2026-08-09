import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LodgingFormModal } from "../LodgingFormModal";
import { createLodging, updateLodging } from "../../../lib/api/lodging";
import type { Lodging } from "../../../types/lodging";
import type { LocationCoordinates, LocationSelection } from "../../location/LocationInput";

vi.mock("../../../lib/api/lodging", () => ({
  createLodging: vi.fn(),
  updateLodging: vi.fn(),
}));

vi.mock("../ChainPicker", () => ({
  ChainPicker: () => null,
}));

// Task 4's established child-picker technique (see ChainPicker above): the
// suite focuses on LodgingFormModal's own logic, not LocationInput's search/
// map/paste internals (those have their own Task 3 test suite). This mock is
// intentionally FUNCTIONAL (not just `() => null`) so one test can exercise
// the wiring contract end-to-end: it renders the received `value` (to assert
// pin-seeding on edit) and a button that fires a full `LocationSelection` via
// `onChange` (to assert the payload picks up address/city/country/lat/lon).
const MOCK_SELECTION: LocationSelection = {
  lat: 47.3769,
  lon: 8.5417,
  name: "Hotel Adlon",
  address: "Unter den Linden 77",
  city: "Berlin",
  country: "Germany",
  countryCode: "DE",
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

const baseLodging: Lodging = {
  id: "lodging-1",
  userId: "user-1",
  type: "hotel",
  name: "Old Name",
  chainId: null,
  chain: null,
  address: "Bahnhofstrasse 1",
  city: "Zürich",
  country: "CH",
  lat: null,
  lon: null,
  stars: null,
  amenities: [],
  notes: "Old notes",
  dataSource: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  stays: [],
  overallRating: null,
  stayCount: 0,
  nights: 0,
  totalSpendBase: 0,
  totalSpendBaseByCurrency: {},
};

describe("LodgingFormModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Finding 4: an emptied field must send an explicit `null`, not `undefined`
  // — otherwise JSON.stringify drops it and the backend reads the PATCH as
  // "field unchanged", so a previously-set address/city/country/notes could
  // never actually be cleared.
  it("sends null (not undefined) for cleared address/city/country/notes on edit", async () => {
    vi.mocked(updateLodging).mockResolvedValue({ ...baseLodging });

    render(
      <LodgingFormModal mode="edit" lodging={baseLodging} onClose={vi.fn()} onSaved={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText("lodging:field.address"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("lodging:field.city"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("lodging:field.country"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("lodging:field.notes"), { target: { value: "" } });

    await userEvent.click(screen.getByText("common:buttons.save"));

    await waitFor(() => expect(updateLodging).toHaveBeenCalled());
    const [, payload] = vi.mocked(updateLodging).mock.calls[0];
    expect(payload.address).toBeNull();
    expect(payload.city).toBeNull();
    expect(payload.country).toBeNull();
    expect(payload.notes).toBeNull();
    expect(payload.address).not.toBeUndefined();
    expect(payload.notes).not.toBeUndefined();
  });

  it("offers all five lodging types in the type selector", () => {
    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);

    const select = screen.getByLabelText("lodging:field.type") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["hotel", "campsite", "guesthouse", "apartment", "hostel"]);
  });

  it("creates a lodging with the entered fields", async () => {
    vi.mocked(createLodging).mockResolvedValue({ ...baseLodging, id: "new-lodging" });
    const onSaved = vi.fn();

    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText("lodging:field.name"), {
      target: { value: "New Hotel" },
    });
    await userEvent.click(screen.getByText("common:buttons.save"));

    await waitFor(() => expect(createLodging).toHaveBeenCalled());
    const [payload] = vi.mocked(createLodging).mock.calls[0];
    expect(payload.name).toBe("New Hotel");
    // Manual-only flow (no LocationInput selection made): the payload still
    // carries explicit `null` coords, not `undefined` — geocode-on-save
    // stays entirely unchanged by this task.
    expect(payload.lat).toBeNull();
    expect(payload.lon).toBeNull();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "new-lodging" }));
  });

  it("seeds the LocationInput pin from the stored lodging coordinates on edit", () => {
    render(
      <LodgingFormModal
        mode="edit"
        lodging={{ ...baseLodging, lat: 52.516, lon: 13.3777 }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByTestId("location-input-value")).toHaveTextContent("52.516,13.3777");
  });

  it("fills address/city/country/lat/lon from a LocationInput selection but never overwrites a pre-filled name", async () => {
    vi.mocked(updateLodging).mockResolvedValue({ ...baseLodging });

    render(
      <LodgingFormModal mode="edit" lodging={baseLodging} onClose={vi.fn()} onSaved={vi.fn()} />
    );

    await userEvent.click(screen.getByText("mock-select-location"));
    await userEvent.click(screen.getByText("common:buttons.save"));

    await waitFor(() => expect(updateLodging).toHaveBeenCalled());
    const [, payload] = vi.mocked(updateLodging).mock.calls[0];
    expect(payload.address).toBe("Unter den Linden 77");
    expect(payload.city).toBe("Berlin");
    expect(payload.country).toBe("Germany");
    expect(payload.lat).toBe(47.3769);
    expect(payload.lon).toBe(8.5417);
    // `baseLodging.name` is "Old Name" — the selection's "Hotel Adlon" must
    // NOT overwrite it (never overwrite user text).
    expect(payload.name).toBe("Old Name");
  });

  it("fills the name from a LocationInput selection when the name is still empty", async () => {
    vi.mocked(createLodging).mockResolvedValue({ ...baseLodging, id: "new-lodging" });

    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByText("mock-select-location"));
    await userEvent.click(screen.getByText("common:buttons.save"));

    await waitFor(() => expect(createLodging).toHaveBeenCalled());
    const [payload] = vi.mocked(createLodging).mock.calls[0];
    expect(payload.name).toBe("Hotel Adlon");
  });

  it("clears the pin via the clear affordance and sends explicit null coords", async () => {
    vi.mocked(updateLodging).mockResolvedValue({ ...baseLodging });

    render(
      <LodgingFormModal
        mode="edit"
        lodging={{ ...baseLodging, lat: 52.516, lon: 13.3777 }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    // The clear affordance only renders once a position is set.
    const clearButton = screen.getByText("location:clear");
    await userEvent.click(clearButton);

    expect(screen.getByTestId("location-input-value")).toHaveTextContent("null");
    expect(screen.queryByText("location:clear")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("common:buttons.save"));

    await waitFor(() => expect(updateLodging).toHaveBeenCalled());
    const [, payload] = vi.mocked(updateLodging).mock.calls[0];
    expect(payload.lat).toBeNull();
    expect(payload.lon).toBeNull();
  });
});
