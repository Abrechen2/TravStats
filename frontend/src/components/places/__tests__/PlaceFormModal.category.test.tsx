import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Place } from "../../../types/place";

const createPlaceMock = vi.fn();

vi.mock("../../../lib/api/places", () => ({
  createPlace: (...a: unknown[]) => createPlaceMock(...a),
  updatePlace: vi.fn(),
}));

vi.mock("../../../lib/api/placeLists", () => ({
  listPlaceLists: () => Promise.resolve([]),
  addPlaceToList: vi.fn(),
}));

// The real search-hit → selection mapping is used, so the test fails if the
// OSM value is dropped on its way from the geocoder to the form.
vi.mock("../../location/LocationInput", async () => {
  const actual = await vi.importActual<typeof import("../../location/LocationInput")>(
    "../../location/LocationInput"
  );
  return {
    ...actual,
    LocationInput: ({ onChange }: { onChange: (s: unknown) => void }) => (
      <button
        type="button"
        data-testid="pick-location"
        onClick={() =>
          onChange(
            actual.placeToSelection({
              name: "Kolosseum",
              lat: 41.89,
              lon: 12.49,
              type: "attraction",
            })
          )
        }
      >
        search
      </button>
    ),
  };
});

import { PlaceFormModal } from "../PlaceFormModal";

/**
 * Picking "Kolosseum" from the search left the category at "Sonstiges": the
 * guess was fed the display name instead of the geocoder's OSM value, and no
 * place is called "attraction".
 */
describe("PlaceFormModal — category guess from a search hit", () => {
  beforeEach(() => {
    createPlaceMock.mockReset().mockResolvedValue({ id: "p1", name: "Kolosseum" } as Place);
  });

  it("sets the category from the hit's OSM value and saves it", async () => {
    const user = userEvent.setup();
    render(<PlaceFormModal place={null} onClose={() => {}} onSaved={() => {}} />);

    await user.click(screen.getByTestId("pick-location"));

    const select = screen.getByDisplayValue(/places:categories\.landmark/) as HTMLSelectElement;
    expect(select.value).toBe("landmark");

    await user.click(screen.getByText("common:buttons.save"));
    await waitFor(() => expect(createPlaceMock).toHaveBeenCalled());
    expect(createPlaceMock.mock.calls[0][0]).toMatchObject({
      name: "Kolosseum",
      category: "landmark",
    });
  });
});
