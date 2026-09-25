import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VisitDateChips } from "../VisitDateChips";

const getVisitDateSuggestions = vi.fn();

vi.mock("../../../lib/api/places", () => ({
  getVisitDateSuggestions: (...a: unknown[]) => getVisitDateSuggestions(...a),
}));

const SUGGESTIONS = [
  { date: "2024-05-10", source: "stay", label: "Hotel Forum", photoCount: null },
  { date: "2024-05-09", source: "flight", label: "FCO", photoCount: 3 },
  { date: "2023-07-01", source: "photo", label: null, photoCount: 2 },
];

/**
 * The add-visit form's date chips: offered under an EMPTY date field, never
 * written by themselves, and narrowed by the trip the form has chosen.
 */
describe("VisitDateChips", () => {
  beforeEach(() => {
    getVisitDateSuggestions.mockReset();
    getVisitDateSuggestions.mockResolvedValue(SUGGESTIONS);
  });

  it("offers each suggested date with where it came from, and picks on click", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<VisitDateChips placeId="p1" tripId="" value="" onPick={onPick} />);

    const chips = await screen.findAllByRole("button", { name: /suggestionChip/ });
    expect(chips.map((c) => c.textContent)).toEqual([
      "2024-05-10 · Hotel Forum",
      "2024-05-09 · places:detail.dateSuggestionArrival · places:detail.dateSuggestionPhotos",
      "2023-07-01 · places:detail.dateSuggestionPhotos",
    ]);
    expect(getVisitDateSuggestions).toHaveBeenCalledWith("p1", null);

    await user.click(chips[0]);
    expect(onPick).toHaveBeenCalledWith("2024-05-10");
  });

  it("steps aside once the date field has a value", async () => {
    const { rerender } = render(
      <VisitDateChips placeId="p1" tripId="" value="" onPick={vi.fn()} />
    );
    await screen.findAllByRole("button", { name: /suggestionChip/ });
    rerender(<VisitDateChips placeId="p1" tripId="" value="2024-05-10" onPick={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /suggestionChip/ })).toBeNull();
  });

  it("asks again, narrowed, when a trip is chosen", async () => {
    const { rerender } = render(
      <VisitDateChips placeId="p1" tripId="" value="" onPick={vi.fn()} />
    );
    await screen.findAllByRole("button", { name: /suggestionChip/ });
    rerender(<VisitDateChips placeId="p1" tripId="t1" value="" onPick={vi.fn()} />);
    await waitFor(() => expect(getVisitDateSuggestions).toHaveBeenLastCalledWith("p1", "t1"));
  });

  it("shows nothing when the request fails", async () => {
    getVisitDateSuggestions.mockRejectedValue(new Error("down"));
    render(<VisitDateChips placeId="p1" tripId="" value="" onPick={vi.fn()} />);
    await waitFor(() => expect(getVisitDateSuggestions).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /suggestionChip/ })).toBeNull();
  });
});
