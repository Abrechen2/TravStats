import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EntryPhotos } from "../EntryPhotos";

const listEntryPhotos = vi.fn();
const getEntryPhotoSuggestions = vi.fn();
const linkEntryPhotos = vi.fn();
const removeEntryPhoto = vi.fn();
const removeAutoEntryPhotos = vi.fn();
const clearEntryPhotoRefusals = vi.fn();
vi.mock("../../../lib/api/entryPhotos", () => ({
  listEntryPhotos: (...a: unknown[]) => listEntryPhotos(...a),
  getEntryPhotoSuggestions: (...a: unknown[]) => getEntryPhotoSuggestions(...a),
  linkEntryPhotos: (...a: unknown[]) => linkEntryPhotos(...a),
  removeEntryPhoto: (...a: unknown[]) => removeEntryPhoto(...a),
  removeAutoEntryPhotos: (...a: unknown[]) => removeAutoEntryPhotos(...a),
  clearEntryPhotoRefusals: (...a: unknown[]) => clearEntryPhotoRefusals(...a),
}));
const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const AUTO = {
  id: "l-1",
  url: "/f/1",
  provider: "photoprism",
  assetId: "a1",
  provenance: "auto",
  takenAt: null,
  mimetype: "image/jpeg",
};

describe("EntryPhotos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names an automatic link and its source", async () => {
    listEntryPhotos.mockResolvedValue([AUTO]);
    render(<EntryPhotos kind="flight" entryId="f-1" />);
    expect(await screen.findByText("common:entryPhotos.autoLabel")).toBeTruthy();
    expect(listEntryPhotos).toHaveBeenCalledWith("flight", "f-1");
  });

  it("says when the photos could not be loaded instead of showing 'none'", async () => {
    listEntryPhotos.mockRejectedValue(new Error("down"));
    render(<EntryPhotos kind="stay" entryId="s-1" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("common:entryPhotos.none")).toBeNull();
  });

  it("drops a removed photo only after the server said so; a failed removal says so", async () => {
    listEntryPhotos.mockResolvedValue([AUTO]);
    removeEntryPhoto.mockRejectedValueOnce(new Error("500")).mockResolvedValueOnce(undefined);
    render(<EntryPhotos kind="rail" entryId="r-1" />);
    await userEvent.click(await screen.findByRole("button", { name: "common:entryPhotos.remove" }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "common:entryPhotos.removeFailed")
    );
    expect(screen.getByRole("img")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "common:entryPhotos.remove" }));
    await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
  });

  it("links exactly what was picked, per source, and shows a failing source", async () => {
    listEntryPhotos.mockResolvedValue([]);
    getEntryPhotoSuggestions.mockResolvedValue({
      untimed: false,
      sources: { immich: "unreachable", photoprism: "ok" },
      suggestions: [
        {
          url: "/s/1",
          provider: "photoprism",
          assetId: "p1",
          takenAt: null,
          mimetype: "image/jpeg",
        },
        { url: "/s/2", provider: "immich", assetId: "i1", takenAt: null, mimetype: "image/jpeg" },
      ],
    });
    linkEntryPhotos.mockResolvedValue({ linked: 1, skipped: 0 });
    render(<EntryPhotos kind="ferry" entryId="fe-1" />);
    await userEvent.click(await screen.findByRole("button", { name: "common:entryPhotos.add" }));
    expect(await screen.findByText("common:entryPhotos.sourceDown")).toBeTruthy();
    const tiles = await screen.findAllByRole("button", { pressed: false });
    await userEvent.click(tiles[0]);
    await userEvent.click(screen.getByRole("button", { name: "common:entryPhotos.link" }));
    await waitFor(() =>
      expect(linkEntryPhotos).toHaveBeenCalledWith("ferry", "fe-1", "photoprism", ["p1"])
    );
    expect(linkEntryPhotos).toHaveBeenCalledTimes(1);
  });

  it("explains an entry without time or place instead of an empty list", async () => {
    listEntryPhotos.mockResolvedValue([]);
    getEntryPhotoSuggestions.mockResolvedValue({ untimed: true, sources: {}, suggestions: [] });
    render(<EntryPhotos kind="cruiseStop" entryId="c-1" />);
    await userEvent.click(await screen.findByRole("button", { name: "common:entryPhotos.add" }));
    expect(await screen.findByText("common:entryPhotos.untimed")).toBeTruthy();
  });
});
