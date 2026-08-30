import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Place } from "../../../types/place";

const createPlaceMock = vi.fn();
const updatePlaceMock = vi.fn();
const listPlaceListsMock = vi.fn();
const addPlaceToListMock = vi.fn();

vi.mock("../../../lib/api/places", () => ({
  createPlace: (...a: unknown[]) => createPlaceMock(...a),
  updatePlace: (...a: unknown[]) => updatePlaceMock(...a),
}));

vi.mock("../../../lib/api/placeLists", () => ({
  listPlaceLists: (...a: unknown[]) => listPlaceListsMock(...a),
  addPlaceToList: (...a: unknown[]) => addPlaceToListMock(...a),
}));

vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({ onChange }: { onChange: (s: unknown) => void }) => (
    <button
      type="button"
      data-testid="pick-location"
      onClick={() => onChange({ lat: 41.9, lon: 12.48, name: "Trevi" })}
    >
      search
    </button>
  ),
}));

import { PlaceFormModal } from "../PlaceFormModal";

/**
 * Dropping a new place straight into a list.
 *
 * Without it the flow was: create the place, leave the dialog, open the list,
 * search for the place you just typed, add it (Alex, 2026-08-29).
 *
 * The case that matters is the failure one. The place is created FIRST and the
 * memberships are added after, so a list that refuses must not undo the
 * creation — losing a place because one list said no is a far worse trade than
 * an unfiled place.
 */
const saved = { id: "p-new", name: "Trevi" } as unknown as Place;

const list = (id: string, name: string, curatedKey: string | null = null) => ({
  id,
  name,
  color: "#f0a947",
  icon: null,
  curatedKey,
  labelMode: "name",
  sortIdx: 0,
  description: null,
  placeCount: 0,
  visitedCount: 0,
  countryCount: 0,
  createdAt: "",
  updatedAt: "",
});

describe("PlaceFormModal — adding to lists on create", () => {
  beforeEach(() => {
    createPlaceMock.mockReset().mockResolvedValue(saved);
    updatePlaceMock.mockReset();
    addPlaceToListMock.mockReset().mockResolvedValue(undefined);
    listPlaceListsMock.mockReset().mockResolvedValue([list("l1", "Maccis"), list("l2", "Rom")]);
  });

  const fillAndSave = async (): Promise<void> => {
    const user = userEvent.setup();
    await user.click(screen.getByTestId("pick-location"));
    await user.click(screen.getByText("common:buttons.save"));
  };

  it("adds the new place to every list that was picked", async () => {
    const user = userEvent.setup();
    render(<PlaceFormModal place={null} onClose={() => {}} onSaved={() => {}} />);

    await waitFor(() => expect(screen.getByText("Maccis")).toBeInTheDocument());
    await user.click(screen.getByText("Maccis"));
    await fillAndSave();

    await waitFor(() => expect(addPlaceToListMock).toHaveBeenCalledWith("l1", "p-new"));
    expect(addPlaceToListMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the place when a list refuses it", async () => {
    addPlaceToListMock.mockRejectedValue(new Error("409"));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<PlaceFormModal place={null} onClose={() => {}} onSaved={onSaved} />);

    await waitFor(() => expect(screen.getByText("Maccis")).toBeInTheDocument());
    await user.click(screen.getByText("Maccis"));
    await fillAndSave();

    // The place was created and is reported as created. Only the filing failed.
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(createPlaceMock).toHaveBeenCalledTimes(1);
  });

  it("does not offer a subscribed checklist", async () => {
    // Its membership comes from the catalogue and the server answers 409 — a
    // button that cannot work is worse than no button.
    listPlaceListsMock.mockResolvedValue([
      list("l1", "Maccis"),
      list("l9", "UNESCO-Welterbe", "world-heritage"),
    ]);
    render(<PlaceFormModal place={null} onClose={() => {}} onSaved={() => {}} />);

    await waitFor(() => expect(screen.getByText("Maccis")).toBeInTheDocument());
    expect(screen.queryByText("UNESCO-Welterbe")).not.toBeInTheDocument();
  });

  it("offers nothing at all when editing an existing place", async () => {
    // A picker that started empty on an existing place would read as "in no
    // list" and invite fixing something that is not broken.
    render(
      <PlaceFormModal
        place={{ ...saved, category: "restaurant", lat: 41.9, lon: 12.48, visits: [] } as unknown as Place}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText("common:buttons.save")).toBeInTheDocument());
    expect(listPlaceListsMock).not.toHaveBeenCalled();
    expect(screen.queryByText("places:form.addToLists")).not.toBeInTheDocument();
  });
});
