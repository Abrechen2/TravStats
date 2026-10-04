import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Place } from "../../../types/place";

const createPlaceMock = vi.fn();
const updatePlaceMock = vi.fn();

vi.mock("../../../lib/api/places", () => ({
  createPlace: (...a: unknown[]) => createPlaceMock(...a),
  updatePlace: (...a: unknown[]) => updatePlaceMock(...a),
}));

vi.mock("../../../lib/api/placeLists", () => ({
  listPlaceLists: () => Promise.resolve([]),
  addPlaceToList: vi.fn(),
}));

// The real hit → selection mapping, so the test fails if the second name is
// dropped between the geocoder and the form.
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
              name: "Seoul Station",
              localName: "서울역",
              externalRef: "osm:node/1",
              lat: 37.5547,
              lon: 126.9707,
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

/** forgejo#199: a place picked from search keeps the name on the sign. */
describe("PlaceFormModal — the second name", () => {
  beforeEach(() => {
    createPlaceMock.mockReset().mockResolvedValue({ id: "p1", name: "Seoul Station" } as Place);
    updatePlaceMock.mockReset().mockResolvedValue({ id: "p1", name: "Seoul Station" } as Place);
  });

  it("sends the picked hit's local name with the new place", async () => {
    const user = userEvent.setup();
    render(<PlaceFormModal place={null} onClose={() => {}} onSaved={() => {}} />);

    await user.click(screen.getByTestId("pick-location"));
    expect(screen.getByDisplayValue("서울역")).toBeInTheDocument();

    await user.click(screen.getByText("common:buttons.save"));
    await waitFor(() => expect(createPlaceMock).toHaveBeenCalled());
    expect(createPlaceMock.mock.calls[0][0]).toMatchObject({
      name: "Seoul Station",
      localName: "서울역",
      externalRef: "osm:node/1",
    });
  });

  it("clears the second name on edit when the field is emptied", async () => {
    const user = userEvent.setup();
    const place = {
      id: "p1",
      name: "Seoul Station",
      localName: "서울역",
      category: "transport",
      lat: 37.5547,
      lon: 126.9707,
      address: null,
      city: "Seoul",
      country: "South Korea",
      notes: null,
      visited: true,
      externalRef: null,
    } as unknown as Place;
    render(<PlaceFormModal place={place} onClose={() => {}} onSaved={() => {}} />);

    await user.clear(screen.getByDisplayValue("서울역"));
    await user.click(screen.getByText("common:buttons.save"));
    await waitFor(() => expect(updatePlaceMock).toHaveBeenCalled());
    expect(updatePlaceMock.mock.calls[0][1]).toMatchObject({ localName: null });
  });
});
