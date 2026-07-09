import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.hoisted lets these vi.fn()s survive vi.mock factory hoisting and stay
// reachable from the test bodies below (see ImmichConnectionCard.test.tsx).
const { getAlbumAssets, unlinkAlbum, resyncAlbum, getImportJob } = vi.hoisted(() => ({
  getAlbumAssets: vi.fn(),
  unlinkAlbum: vi.fn(),
  resyncAlbum: vi.fn(),
  getImportJob: vi.fn(),
}));
vi.mock("../../../lib/api/immich", () => ({
  immichApi: { getAlbumAssets, unlinkAlbum, resyncAlbum, getImportJob },
  immichFailureKind: (e: unknown) =>
    (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null,
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));

vi.mock("../PhotoLightbox", () => ({ default: () => <div data-testid="lightbox" /> }));

import ImmichAlbumSection from "../ImmichAlbumSection";
import type { LinkedAlbum } from "../../../types/immich";

const LINK_ALBUM: LinkedAlbum = {
  id: "link-1",
  immichAlbumId: "a1",
  albumName: "Rome",
  assetCount: 2,
  thumbnailAssetId: null,
  mode: "link",
  sortIdx: 0,
  lastSyncedAt: null,
};

const IMPORT_ALBUM: LinkedAlbum = { ...LINK_ALBUM, id: "link-2", mode: "import" };

const ASSETS = [
  { id: "p1", url: "/t1.jpg", previewUrl: "/p1.jpg", takenAt: null, lat: null, lon: null },
  { id: "p2", url: "/t2.jpg", previewUrl: "/p2.jpg", takenAt: null, lat: null, lon: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  getAlbumAssets.mockResolvedValue({ assets: ASSETS });
  unlinkAlbum.mockResolvedValue(undefined);
  resyncAlbum.mockResolvedValue({ job: { status: "running" } });
  getImportJob.mockResolvedValue({ job: null });
});

describe("ImmichAlbumSection", () => {
  it("renders the album header with a live badge and its tiles", async () => {
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(screen.getByText("Rome")).toBeInTheDocument();
    expect(screen.getByText("albums.badgeLink")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "albums.resync" })).not.toBeInTheDocument();
  });

  it("shows a copy badge and a re-sync button for import mode", async () => {
    render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("albums.badgeImport")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "albums.resync" })).toBeInTheDocument();
  });

  it("renders a degraded panel instead of tiles when Immich is unreachable", async () => {
    getAlbumAssets.mockRejectedValue({ response: { data: { error: "unreachable" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("errors.unreachable")).toBeInTheDocument());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "errors.retry" })).toBeInTheDocument();
  });

  it("offers unlink for a deleted album", async () => {
    getAlbumAssets.mockRejectedValue({ response: { data: { error: "notFound" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("errors.notFound")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "albums.unlink" })).toBeInTheDocument();
  });

  it("unlinks a link-mode album without asking about copies", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={onChanged} />);
    await waitFor(() => expect(getAlbumAssets).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "albums.unlink" }));

    await waitFor(() => expect(unlinkAlbum).toHaveBeenCalledWith("trip-1", "link-1", false));
    expect(onChanged).toHaveBeenCalled();
  });

  it("asks whether to delete the copies when unlinking an import-mode album", async () => {
    const user = userEvent.setup();
    render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);
    await waitFor(() => expect(getAlbumAssets).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "albums.unlink" }));
    expect(unlinkAlbum).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "albums.unlinkDeleteCopies" }));
    await waitFor(() => expect(unlinkAlbum).toHaveBeenCalledWith("trip-1", "link-2", true));
  });

  it("kicks a re-sync and polls the job until it completes", async () => {
    getImportJob
      .mockResolvedValueOnce({
        job: {
          status: "running",
          totalAssets: 2,
          processedAssets: 1,
          failedAssets: 0,
          error: null,
        },
      })
      .mockResolvedValue({
        job: {
          status: "completed",
          totalAssets: 2,
          processedAssets: 2,
          failedAssets: 0,
          error: null,
        },
      });

    const user = userEvent.setup();
    render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);
    await waitFor(() => expect(getAlbumAssets).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "albums.resync" }));

    await waitFor(() => expect(resyncAlbum).toHaveBeenCalledWith("trip-1", "link-2"));
    await waitFor(() => expect(screen.getByText("albums.resyncing")).toBeInTheDocument());
    await waitFor(
      () => expect(screen.getByRole("button", { name: "albums.resync" })).toBeEnabled(),
      { timeout: 4000 }
    );
  });
});
