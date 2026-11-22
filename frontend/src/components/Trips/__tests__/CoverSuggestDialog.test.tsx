import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CoverSuggestDialog from "../CoverSuggestDialog";
import type { CoverSuggestions } from "../../../lib/api/coverSuggestions";

const get = vi.fn();
const apply = vi.fn();
vi.mock("../../../lib/api/coverSuggestions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/coverSuggestions")>()),
  coverSuggestionsApi: {
    get: (...a: unknown[]) => get(...a),
    apply: (...a: unknown[]) => apply(...a),
  },
}));

const suggestion = {
  key: "immich:a",
  thumbUrl: "/api/v1/trips/t1/immich/albums/l1/assets/a/file?size=thumbnail",
  takenAt: "2026-05-03T10:00:00.000Z",
  score: 85,
  reasons: [
    { code: "me" as const, points: 40 },
    { code: "placeClose" as const, points: 25 },
    { code: "favorite" as const, points: 20 },
  ],
  apply: { type: "album" as const, linkId: "l1", assetId: "a" },
};
const answer = (over: Partial<CoverSuggestions> = {}): CoverSuggestions => ({
  suggestions: [suggestion],
  abstained: null,
  sources: [{ provider: "immich", photos: "ok", people: "ok" }],
  ...over,
});

describe("CoverSuggestDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the reasons of a suggestion and sets nothing until one is chosen", async () => {
    get.mockResolvedValue(answer());
    render(<CoverSuggestDialog tripId="t1" onClose={vi.fn()} onChosen={vi.fn()} />);
    expect(await screen.findByText(/cover\.reasons\.me/)).toBeInTheDocument();
    expect(screen.getByText(/cover\.reasons\.placeClose/)).toBeInTheDocument();
    expect(screen.getByText(/cover\.reasons\.favorite/)).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });

  it("writes the chosen photo through its own route and then reloads the trip", async () => {
    get.mockResolvedValue(answer());
    apply.mockResolvedValue({ coverImageUrl: "/x" });
    const onChosen = vi.fn();
    const onClose = vi.fn();
    render(<CoverSuggestDialog tripId="t1" onClose={onClose} onChosen={onChosen} />);
    await userEvent.click(await screen.findByRole("button", { name: /cover\.choose$/ }));
    await waitFor(() => expect(onChosen).toHaveBeenCalled());
    expect(apply).toHaveBeenCalledWith("t1", suggestion.apply);
    expect(onClose).toHaveBeenCalled();
  });

  it("says plainly that nothing qualified instead of offering a photo", async () => {
    get.mockResolvedValue(answer({ suggestions: [], abstained: "noneQualified" }));
    render(<CoverSuggestDialog tripId="t1" onClose={vi.fn()} onChosen={vi.fn()} />);
    expect(await screen.findByTestId("cover-abstained")).toHaveTextContent(
      "cover.abstained.noneQualified"
    );
    expect(screen.queryAllByTestId("cover-suggestion")).toHaveLength(0);
  });

  it("names a source that could not be read while still showing the other source's photo", async () => {
    get.mockResolvedValue(
      answer({
        sources: [
          { provider: "immich", photos: "unreachable", people: "notSet" },
          { provider: "photoprism", photos: "ok", people: "ok" },
        ],
      })
    );
    render(<CoverSuggestDialog tripId="t1" onClose={vi.fn()} onChosen={vi.fn()} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("cover.source.photosFailed");
    expect(screen.getAllByTestId("cover-suggestion")).toHaveLength(1);
  });

  it("shows a failed choice as itself and keeps the dialog open", async () => {
    get.mockResolvedValue(answer());
    apply.mockRejectedValue(new Error("boom"));
    const onClose = vi.fn();
    render(<CoverSuggestDialog tripId="t1" onClose={onClose} onChosen={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: /cover\.choose$/ }));
    expect(await screen.findByText(/cover\.chooseFailed/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers a retry when the suggestions cannot be loaded", async () => {
    get.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(answer());
    render(<CoverSuggestDialog tripId="t1" onClose={vi.fn()} onChosen={vi.fn()} />);
    expect(await screen.findByText(/cover\.loadFailed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /cover\.retry/ }));
    expect(await screen.findByTestId("cover-suggestion")).toBeInTheDocument();
  });
});
