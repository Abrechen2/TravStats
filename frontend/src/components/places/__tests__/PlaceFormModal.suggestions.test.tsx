import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * forgejo#405: the place form offers the cities and countries of the user's own
 * places, and a picked city brings its country along; a failed load says so.
 */
vi.mock("../../../lib/api/places", () => ({ createPlace: vi.fn(), updatePlace: vi.fn() }));
vi.mock("../../../lib/api/placeLists", () => ({
  listPlaceLists: () => Promise.resolve([]),
  addPlaceToList: vi.fn(),
}));
vi.mock("../../location/LocationInput", () => ({
  LocationInput: () => null,
  placeToSelection: vi.fn(),
}));
const suggestions = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/entrySuggestions", async (original) => ({
  ...(await original<typeof import("../../../lib/api/entrySuggestions")>()),
  entrySuggestionsApi: { place: (...a: unknown[]) => suggestions(...a) },
}));

import { PlaceFormModal } from "../PlaceFormModal";

describe("PlaceFormModal — suggestions from earlier places", () => {
  beforeEach(() => suggestions.mockReset());

  it("offers the user's cities and a picked city fills the empty country with it", async () => {
    suggestions.mockResolvedValue({
      cities: [{ city: "Rom", country: "Italien", isoCountryCode: "IT" }],
      countries: [],
    });
    const user = userEvent.setup();
    render(<PlaceFormModal place={null} onClose={() => {}} onSaved={() => {}} />);

    await user.click(await screen.findByRole("button", { name: "common:suggestionChip" }));

    expect(screen.getByLabelText("places:form.city")).toHaveValue("Rom");
    expect(screen.getByLabelText("places:form.country")).toHaveValue("Italien");
  });

  it("keeps a country the user already typed when a city is picked", async () => {
    suggestions.mockResolvedValue({
      cities: [{ city: "Rom", country: "Italien", isoCountryCode: "IT" }],
      countries: [],
    });
    const user = userEvent.setup();
    render(<PlaceFormModal place={null} onClose={() => {}} onSaved={() => {}} />);
    await user.type(screen.getByLabelText("places:form.country"), "Vatikan");

    await user.click(await screen.findByRole("button", { name: "common:suggestionChip" }));

    expect(screen.getByLabelText("places:form.country")).toHaveValue("Vatikan");
  });
});
