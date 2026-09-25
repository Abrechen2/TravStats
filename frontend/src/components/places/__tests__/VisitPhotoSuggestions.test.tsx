import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VisitPhotoSuggestions } from "../VisitPhotoSuggestions";

const getVisitPhotoSuggestions = vi.fn();
const linkVisitPhotoSuggestions = vi.fn();
const listVisitPhotos = vi.fn();
vi.mock("../../../lib/api/places", () => ({
  getVisitPhotoSuggestions: (...a: unknown[]) => getVisitPhotoSuggestions(...a),
  linkVisitPhotoSuggestions: (...a: unknown[]) => linkVisitPhotoSuggestions(...a),
  listVisitPhotos: (...a: unknown[]) => listVisitPhotos(...a),
}));
const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const TRIP = { kind: "trip", id: "tp-1", url: "/t/1", takenAt: null, distanceM: 40 };
const LIBRARY = { kind: "library", id: "as-1", url: "/l/1", takenAt: null, distanceM: 120 };

/**
 * Package 9, item 2: the visit offers photographs of its day near the place,
 * and a pick is sent back split into trip photos and library ids — never
 * attached without the user choosing it.
 */
describe("VisitPhotoSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks nothing until opened, then links exactly what was picked", async () => {
    getVisitPhotoSuggestions.mockResolvedValue({
      day: "2024-05-01",
      suggestions: [TRIP, LIBRARY],
      library: "ok",
    });
    linkVisitPhotoSuggestions.mockResolvedValue({ linked: 1, skipped: 0 });
    const linkedPhoto = { id: "vp-9", url: "/v/9", caption: null };
    listVisitPhotos.mockResolvedValue([linkedPhoto]);
    const onLinked = vi.fn();
    render(<VisitPhotoSuggestions visitId="visit-1" onLinked={onLinked} />);

    expect(getVisitPhotoSuggestions).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "places:photos.suggest.open" }));

    const tiles = await screen.findAllByRole("button", { pressed: false });
    expect(tiles).toHaveLength(2);
    await userEvent.click(tiles[1]);
    await userEvent.click(screen.getByRole("button", { name: "places:photos.suggest.link" }));

    await waitFor(() =>
      expect(linkVisitPhotoSuggestions).toHaveBeenCalledWith("visit-1", {
        tripPhotoIds: [],
        assetIds: ["as-1"],
      })
    );
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith([linkedPhoto]));
    // The linked one is no longer offered.
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(1);
  });

  it("says why an undated visit gets nothing, and when the library was down", async () => {
    getVisitPhotoSuggestions.mockResolvedValue({
      day: null,
      suggestions: [],
      library: "unreachable",
    });
    render(<VisitPhotoSuggestions visitId="visit-1" onLinked={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "places:photos.suggest.open" }));

    expect(await screen.findByText("places:photos.suggest.undated")).toBeInTheDocument();
    expect(screen.getByText("places:photos.suggest.libraryDown")).toBeInTheDocument();
  });
});
