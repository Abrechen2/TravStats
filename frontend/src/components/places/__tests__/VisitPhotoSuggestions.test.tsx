import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VisitPhotoSuggestions } from "../VisitPhotoSuggestions";

const getVisitPhotoSuggestions = vi.fn();
const linkVisitPhotoSuggestions = vi.fn();
const listVisitPhotos = vi.fn();
const refuseVisitPhotoSuggestions = vi.fn();
const clearVisitPhotoRefusals = vi.fn();
vi.mock("../../../lib/api/places", () => ({
  getVisitPhotoSuggestions: (...a: unknown[]) => getVisitPhotoSuggestions(...a),
  linkVisitPhotoSuggestions: (...a: unknown[]) => linkVisitPhotoSuggestions(...a),
  listVisitPhotos: (...a: unknown[]) => listVisitPhotos(...a),
  refuseVisitPhotoSuggestions: (...a: unknown[]) => refuseVisitPhotoSuggestions(...a),
  clearVisitPhotoRefusals: (...a: unknown[]) => clearVisitPhotoRefusals(...a),
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
/** The rare actions sit in the section ⋯ (owner, 2026-11-22): open it, choose the entry. */
async function menuItem(name: string): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "places:photos.suggest.menuLabel" }));
  await userEvent.click(await screen.findByRole("menuitem", { name }));
}

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
    await menuItem("places:photos.suggest.open");

    const tiles = await screen.findAllByRole("button", { pressed: false });
    expect(tiles).toHaveLength(2);
    await userEvent.click(tiles[1]);
    await userEvent.click(screen.getByRole("button", { name: "places:photos.suggest.link" }));

    await waitFor(() =>
      expect(linkVisitPhotoSuggestions).toHaveBeenCalledWith("visit-1", {
        tripPhotoIds: [],
        assetIds: ["as-1"],
        provider: "immich",
      })
    );
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith([linkedPhoto]));
    // The linked one is no longer offered.
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(1);
  });

  it("links a PhotoPrism pick under its own source, apart from an Immich pick with the same id", async () => {
    getVisitPhotoSuggestions.mockResolvedValue({
      day: "2024-05-01",
      suggestions: [
        { ...LIBRARY, provider: "immich" },
        { ...LIBRARY, url: "/l/2", provider: "photoprism" },
      ],
      library: "ok",
      sources: { immich: "ok", photoprism: "ok" },
    });
    linkVisitPhotoSuggestions.mockResolvedValue({ linked: 1, skipped: 0 });
    listVisitPhotos.mockResolvedValue([]);
    render(<VisitPhotoSuggestions visitId="visit-1" onLinked={vi.fn()} />);
    await menuItem("places:photos.suggest.open");
    const tiles = await screen.findAllByRole("button", { pressed: false });
    await userEvent.click(tiles[1]);
    await userEvent.click(screen.getByRole("button", { name: "places:photos.suggest.link" }));
    await waitFor(() =>
      expect(linkVisitPhotoSuggestions).toHaveBeenCalledWith("visit-1", {
        tripPhotoIds: [],
        assetIds: ["as-1"],
        provider: "photoprism",
      })
    );
    expect(linkVisitPhotoSuggestions).toHaveBeenCalledTimes(1);
  });

  it("shows a failing source even while the other answered", async () => {
    getVisitPhotoSuggestions.mockResolvedValue({
      day: "2024-05-01",
      suggestions: [],
      library: "ok",
      sources: { immich: "ok", photoprism: "auth" },
    });
    render(<VisitPhotoSuggestions visitId="visit-1" onLinked={vi.fn()} />);
    await menuItem("places:photos.suggest.open");
    expect(await screen.findByText("places:photos.suggest.libraryDown")).toBeInTheDocument();
  });

  it("says why an undated visit gets nothing, and when the library was down", async () => {
    getVisitPhotoSuggestions.mockResolvedValue({
      day: null,
      suggestions: [],
      library: "unreachable",
    });
    render(<VisitPhotoSuggestions visitId="visit-1" onLinked={vi.fn()} />);
    await menuItem("places:photos.suggest.open");

    expect(await screen.findByText("places:photos.suggest.undated")).toBeInTheDocument();
    expect(screen.getByText("places:photos.suggest.libraryDown")).toBeInTheDocument();
  });

  // forgejo#249: the distance was a hover-only `title` — never seen on an iPad.
  it("shows each suggestion's distance as text, not as a tooltip", async () => {
    getVisitPhotoSuggestions.mockResolvedValue({
      day: "2024-05-01",
      suggestions: [TRIP],
      library: "ok",
    });
    render(<VisitPhotoSuggestions visitId="v1" onLinked={vi.fn()} />);
    await menuItem("places:photos.suggest.open");
    const tiles = await screen.findAllByRole("button", { pressed: false });
    expect(tiles[0]).toHaveTextContent("places:photos.suggest.distanceShort");
    expect(tiles[0]).not.toHaveAttribute("title");
  });

  // forgejo#397 (forgejo#132 item 13): the server kept refusals, no caller used them.
  it("'Nicht diese' sends the picks and drops the tiles only once the server accepted", async () => {
    getVisitPhotoSuggestions.mockResolvedValue({
      day: "2024-05-01",
      suggestions: [TRIP, LIBRARY],
      library: "ok",
    });
    refuseVisitPhotoSuggestions.mockResolvedValue({ refused: 1, skipped: 0 });
    render(<VisitPhotoSuggestions visitId="visit-1" onLinked={vi.fn()} />);
    await menuItem("places:photos.suggest.open");
    const tiles = await screen.findAllByRole("button", { pressed: false });
    await userEvent.click(tiles[0]);
    await userEvent.click(screen.getByRole("button", { name: "places:photos.suggest.refuse" }));

    await waitFor(() =>
      expect(refuseVisitPhotoSuggestions).toHaveBeenCalledWith("visit-1", {
        tripPhotoIds: ["tp-1"],
        assetIds: [],
        provider: "immich",
      })
    );
    await waitFor(() => expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(1));
  });

  it("keeps the tiles and says why when the refusal fails", async () => {
    getVisitPhotoSuggestions.mockResolvedValue({
      day: "2024-05-01",
      suggestions: [TRIP],
      library: "ok",
    });
    refuseVisitPhotoSuggestions.mockRejectedValue(new Error("500"));
    render(<VisitPhotoSuggestions visitId="visit-1" onLinked={vi.fn()} />);
    await menuItem("places:photos.suggest.open");
    await userEvent.click((await screen.findAllByRole("button", { pressed: false }))[0]);
    await userEvent.click(screen.getByRole("button", { name: "places:photos.suggest.refuse" }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "places:photos.suggest.refuseFailed")
    );
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("undo clears the refusals and asks for suggestions again; a failure is reported", async () => {
    getVisitPhotoSuggestions.mockResolvedValueOnce({
      day: "2024-05-01",
      suggestions: [],
      library: "ok",
    });
    clearVisitPhotoRefusals.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("x"));
    render(<VisitPhotoSuggestions visitId="visit-1" onLinked={vi.fn()} />);
    await menuItem("places:photos.suggest.open");
    await screen.findByText("places:photos.suggest.none");

    getVisitPhotoSuggestions.mockResolvedValueOnce({
      day: "2024-05-01",
      suggestions: [TRIP],
      library: "ok",
    });
    await menuItem("places:photos.suggest.undo");
    await waitFor(() => expect(clearVisitPhotoRefusals).toHaveBeenCalledWith("visit-1"));
    expect(await screen.findAllByRole("button", { pressed: false })).toHaveLength(1);

    await menuItem("places:photos.suggest.undo");
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "places:photos.suggest.undoFailed")
    );
  });
});
