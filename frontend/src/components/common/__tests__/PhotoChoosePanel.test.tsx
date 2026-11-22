import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PhotoChoosePanel, formatTaken, formatWindow } from "../PhotoChoosePanel";

const getPhotoChoices = vi.fn();
const savePhotoChoices = vi.fn();
const listPhotoAlbums = vi.fn();
vi.mock("../../../lib/api/photoChoices", () => ({
  getPhotoChoices: (...a: unknown[]) => getPhotoChoices(...a),
  savePhotoChoices: (...a: unknown[]) => savePhotoChoices(...a),
  listPhotoAlbums: (...a: unknown[]) => listPhotoAlbums(...a),
}));

const choice = (assetId: string, over: Record<string, unknown> = {}) => ({
  provider: "immich",
  assetId,
  url: `/img/${assetId}`,
  takenAt: "2024-05-01T10:00:00.000Z",
  takenAtLocal: "2024-05-01T12:00:00",
  distanceM: 120,
  chosen: false,
  provenance: null,
  refused: false,
  ...over,
});
const data = (over: Record<string, unknown> = {}) => ({
  choices: [
    choice("auto1", { chosen: true, provenance: "auto" }),
    choice("other1"),
    choice("gone", { refused: true }),
  ],
  sources: { immich: "ok" },
  cap: 6,
  openIn: [{ provider: "immich", url: "https://immich.example/search?query=x" }],
  ...over,
});
const target = { type: "visit", visitId: "v1" } as const;

describe("PhotoChoosePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPhotoChoices.mockResolvedValue(data());
    savePhotoChoices.mockResolvedValue({ picked: 1, swapped: 1, refused: 0, skipped: 0 });
  });

  it("ticks the linked photos and sends a swap as one select and one deselect", async () => {
    const onSaved = vi.fn();
    render(<PhotoChoosePanel target={target} onSaved={onSaved} onClose={() => {}} />);
    const tiles = await screen.findAllByRole("button", { pressed: true });
    expect(tiles).toHaveLength(1);
    const save = screen.getByRole("button", { name: "common:photoChoose.save" });
    expect(save).toBeDisabled();
    await userEvent.click(tiles[0]!);
    // Unticked now: the swapped-out photo, "other1", and the one removed earlier.
    await userEvent.click(screen.getAllByRole("button", { pressed: false })[1]!);
    await userEvent.click(save);
    await waitFor(() =>
      expect(savePhotoChoices).toHaveBeenCalledWith(target, {
        select: [{ provider: "immich", assetId: "other1" }],
        deselect: [{ provider: "immich", assetId: "auto1" }],
      })
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("promotes an untouched automatic link only when the user ticks it again after unticking", async () => {
    render(<PhotoChoosePanel target={target} onSaved={() => {}} onClose={() => {}} />);
    const tile = (await screen.findAllByRole("button", { pressed: true }))[0]!;
    await userEvent.click(tile);
    await userEvent.click(screen.getAllByRole("button", { pressed: false })[0]!);
    expect(screen.getByRole("button", { name: "common:photoChoose.save" })).toBeEnabled();
  });

  it("offers a link into the source UI that opens in a new tab, and none without a base URL", async () => {
    const { unmount } = render(
      <PhotoChoosePanel target={target} onSaved={() => {}} onClose={() => {}} />
    );
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await userEvent.click(
      await screen.findByRole("button", { name: "common:entryPhotos.menuLabel" })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "common:photoChoose.openIn.immich" })
    );
    expect(open).toHaveBeenCalledWith(
      "https://immich.example/search?query=x",
      "_blank",
      "noopener,noreferrer"
    );
    open.mockRestore();
    unmount();
    getPhotoChoices.mockResolvedValue(data({ openIn: [] }));
    render(<PhotoChoosePanel target={target} onSaved={() => {}} onClose={() => {}} />);
    await screen.findAllByRole("button", { pressed: true });
    expect(screen.queryByRole("button", { name: "common:entryPhotos.menuLabel" })).toBeNull();
  });

  it("says so when the save fails instead of closing silently", async () => {
    savePhotoChoices.mockRejectedValue(new Error("boom"));
    const onSaved = vi.fn();
    render(<PhotoChoosePanel target={target} onSaved={onSaved} onClose={() => {}} />);
    await userEvent.click((await screen.findAllByRole("button", { pressed: false }))[0]!);
    await userEvent.click(screen.getByRole("button", { name: "common:photoChoose.save" }));
    await waitFor(() => expect(savePhotoChoices).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows the place's wall clock, not the UTC instant, and no time when the zone is unknown", async () => {
    // 10:00Z is 12:00 in Rome: the server sends the local clock and it is shown as sent.
    expect(formatTaken("2024-05-01T12:00:00", "en")).toMatch(/12:00/);
    expect(formatTaken("2024-05-01T12:00:00", "en")).not.toMatch(/10:00/);
    expect(formatTaken(null, "en")).toBe("");
    render(<PhotoChoosePanel target={target} onSaved={() => {}} onClose={() => {}} />);
    await screen.findAllByRole("button", { pressed: true });
    expect(document.body.textContent).toMatch(/12:00/);
    expect(document.body.textContent).not.toMatch(/10:00/);
    expect(document.body.textContent).not.toContain("UTC");
  });

  // rc.43 owner report: the panel could not be closed and its list could not be scrolled. It sat
  // inline in the stay list's own scroll box; it is a dialog now, with ONE scroll container.
  describe("as a dialog", () => {
    it("closes with the ×, with Escape and with a click on the backdrop", async () => {
      const onClose = vi.fn();
      const { rerender } = render(
        <PhotoChoosePanel target={target} onSaved={() => {}} onClose={onClose} />
      );
      await screen.findAllByRole("button", { pressed: true });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "common:buttons.close" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      await userEvent.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(2);
      await userEvent.click(screen.getByTestId("modal-backdrop"));
      expect(onClose).toHaveBeenCalledTimes(3);
      rerender(<PhotoChoosePanel target={target} onSaved={() => {}} onClose={onClose} />);
    });

    it("puts the list in a scroll container of its own, with the buttons outside it", async () => {
      render(<PhotoChoosePanel target={target} onSaved={() => {}} onClose={() => {}} />);
      const tile = (await screen.findAllByRole("button", { pressed: true }))[0]!;
      let node: HTMLElement | null = tile;
      let scroller: HTMLElement | null = null;
      while (node && !scroller) {
        node = node.parentElement;
        if (node && node.className.includes("overflow-y-auto")) scroller = node;
      }
      expect(scroller).not.toBeNull();
      // Save and close live in the footer, not inside what scrolls: always reachable.
      const save = screen.getByRole("button", { name: "common:photoChoose.save" });
      expect(scroller!.contains(save)).toBe(false);
    });

    it("asks before closing with unsaved ticks", async () => {
      const onClose = vi.fn();
      render(<PhotoChoosePanel target={target} onSaved={() => {}} onClose={onClose} />);
      await userEvent.click((await screen.findAllByRole("button", { pressed: false }))[0]!);
      await userEvent.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("window, count and album", () => {
    const entry = { type: "entry", kind: "stay", entryId: "s1" } as const;
    // ICU separates the parts with no-break spaces, which a string comparison would trip on.
    const plain = (text: string): string => text.replace(/\s/g, " ");

    it("says which days were searched and how many of the candidates are listed, and loads all on request", async () => {
      getPhotoChoices.mockResolvedValueOnce(
        data({ window: { from: "2024-05-03", to: "2024-05-07" }, total: 340, thinned: true })
      );
      render(<PhotoChoosePanel target={entry} onSaved={() => {}} onClose={() => {}} />);
      const line = await screen.findByTestId("photo-choose-window");
      expect(line).toHaveTextContent("common:photoChoose.window");
      await userEvent.click(screen.getByTestId("photo-choose-all"));
      await waitFor(() =>
        expect(getPhotoChoices).toHaveBeenLastCalledWith(entry, { all: true, album: undefined })
      );
    });

    it("formats the window as calendar days, never shifted by the viewer's zone", () => {
      expect(plain(formatWindow("2024-05-03", "2024-05-07", "en"))).toBe("May 3 – 7, 2024");
      expect(plain(formatWindow("2024-05-03", "2024-05-03", "en"))).toBe("May 3, 2024");
      expect(plain(formatWindow("2024-05-03", "2024-05-07", "de"))).toBe("3.–7. Mai 2024");
    });

    it("lists the albums of the source and shows only that album's photos, saving them against it", async () => {
      listPhotoAlbums.mockImplementation(async (_t: unknown, provider: string) =>
        provider === "immich" ? [{ id: "al1", albumName: "Rome 2024", assetCount: 12 }] : []
      );
      render(<PhotoChoosePanel target={entry} onSaved={() => {}} onClose={() => {}} />);
      await userEvent.click(await screen.findByTestId("photo-choose-album"));
      getPhotoChoices.mockResolvedValueOnce(data({ choices: [choice("fromAlbum")] }));
      await userEvent.click(await screen.findByTestId("photo-album-immich-al1"));
      await waitFor(() =>
        expect(getPhotoChoices).toHaveBeenLastCalledWith(entry, {
          all: false,
          album: { provider: "immich", albumId: "al1", anyDate: false, name: "Rome 2024" },
        })
      );
      await userEvent.click((await screen.findAllByRole("button", { pressed: false }))[0]!);
      await userEvent.click(screen.getByRole("button", { name: "common:photoChoose.save" }));
      await waitFor(() =>
        expect(savePhotoChoices).toHaveBeenCalledWith(entry, {
          select: [{ provider: "immich", assetId: "fromAlbum" }],
          deselect: [],
          album: { provider: "immich", albumId: "al1", anyDate: false },
        })
      );
    });

    it("offers no album picking for a place visit", async () => {
      render(<PhotoChoosePanel target={target} onSaved={() => {}} onClose={() => {}} />);
      await screen.findAllByRole("button", { pressed: true });
      expect(screen.queryByTestId("photo-choose-album")).toBeNull();
    });
  });
});
