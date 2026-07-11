import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LodgingFormModal } from "../LodgingFormModal";
import { createLodging, updateLodging } from "../../../lib/api/lodging";
import type { Lodging } from "../../../types/lodging";

vi.mock("../../../lib/api/lodging", () => ({
  createLodging: vi.fn(),
  updateLodging: vi.fn(),
}));

vi.mock("../ChainPicker", () => ({
  ChainPicker: () => null,
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
      <LodgingFormModal
        mode="edit"
        lodging={baseLodging}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
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
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "new-lodging" }));
  });
});
