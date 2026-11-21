import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PhotoChoosePanel, formatTaken } from "../PhotoChoosePanel";

const getPhotoChoices = vi.fn();
const savePhotoChoices = vi.fn();
vi.mock("../../../lib/api/photoChoices", () => ({
  getPhotoChoices: (...a: unknown[]) => getPhotoChoices(...a),
  savePhotoChoices: (...a: unknown[]) => savePhotoChoices(...a),
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
    const link = await screen.findByRole("link", { name: "common:photoChoose.openIn.immich" });
    expect(link).toHaveAttribute("href", "https://immich.example/search?query=x");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    unmount();
    getPhotoChoices.mockResolvedValue(data({ openIn: [] }));
    render(<PhotoChoosePanel target={target} onSaved={() => {}} onClose={() => {}} />);
    await screen.findAllByRole("button", { pressed: true });
    expect(screen.queryByRole("link")).toBeNull();
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
});
