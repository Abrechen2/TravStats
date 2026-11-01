import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Place } from "../../../types/place";

const updatePlaceMock = vi.fn();

vi.mock("../../../lib/api/places", () => ({
  createPlace: vi.fn(),
  updatePlace: (...a: unknown[]) => updatePlaceMock(...a),
}));
vi.mock("../../../lib/api/placeLists", () => ({
  listPlaceLists: () => Promise.resolve([]),
  addPlaceToList: vi.fn(),
}));
vi.mock("../../../hooks/useTagSuggestions", () => ({ useTagSuggestions: () => [] }));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => <div /> }));

import { PlaceFormModal } from "../PlaceFormModal";

/** forgejo#405: places were one of the four domains without tags. */
describe("PlaceFormModal — tags", () => {
  beforeEach(() => {
    updatePlaceMock.mockReset().mockResolvedValue({ id: "p1", name: "Wartburg" } as Place);
  });

  it("keeps the stored tags, adds a typed one and sends the list", async () => {
    const user = userEvent.setup();
    const place = {
      id: "p1",
      name: "Wartburg",
      category: "landmark",
      lat: 50.96,
      lon: 10.3,
      visited: true,
      tags: ["burg"],
    } as unknown as Place;
    render(<PlaceFormModal place={place} onClose={() => {}} onSaved={() => {}} />);

    await user.type(screen.getByLabelText("places:form.tags"), "unesco,");
    await user.click(screen.getByText("common:buttons.save"));
    await waitFor(() => expect(updatePlaceMock).toHaveBeenCalled());
    expect(updatePlaceMock.mock.calls[0][1]).toMatchObject({ tags: ["burg", "unesco"] });
  });
});
