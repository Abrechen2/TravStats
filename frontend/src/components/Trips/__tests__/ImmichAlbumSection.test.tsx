import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
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
const KNOWN_FAILURE_KINDS = [
  "notConfigured",
  "unreachable",
  "auth",
  "notFound",
  "protocol",
  "invalidUrl",
];
vi.mock("../../../lib/api/immich", () => ({
  immichApi: { getAlbumAssets, unlinkAlbum, resyncAlbum, getImportJob },
  immichFailureKind: (e: unknown) =>
    (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null,
  failureKey: (kind: unknown) =>
    typeof kind === "string" && KNOWN_FAILURE_KINDS.includes(kind)
      ? `errors.${kind}`
      : "errors.unknown",
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

  // An unrecognised backend failure kind (a future value the frontend has
  // never seen, e.g. a validation-schema addition on the backend) must
  // degrade to the neutral "errors.unknown" panel — never "errors.unreachable",
  // which would falsely assert a network failure that was never established.
  it("renders errors.unknown (not errors.unreachable) for an unrecognised failure kind", async () => {
    getAlbumAssets.mockRejectedValue({ response: { data: { error: "brand-new-kind" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("errors.unknown")).toBeInTheDocument());
    expect(screen.queryByText("errors.unreachable")).not.toBeInTheDocument();
  });

  it("offers unlink for a deleted album", async () => {
    getAlbumAssets.mockRejectedValue({ response: { data: { error: "notFound" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("errors.notFound")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "albums.unlink" })).toBeInTheDocument();
  });

  // Regression guard for the `failure !== "errors.notFound"` check on line ~220:
  // that literal must keep the "errors." prefix in sync with the full i18n key
  // now stored in `failure` (it used to compare against the bare kind
  // "notFound"). Without this test, dropping the prefix again would make the
  // retry button reappear for a deleted album — a useless "Try again" click,
  // since re-fetching a permanently-gone album can never succeed — while every
  // other test still passes.
  it("does NOT render a retry button when the album was not found (permanent failure)", async () => {
    getAlbumAssets.mockRejectedValue({ response: { data: { error: "notFound" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("errors.notFound")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "errors.retry" })).not.toBeInTheDocument();
  });

  it("DOES render a retry button for a retryable failure (unreachable)", async () => {
    getAlbumAssets.mockRejectedValue({ response: { data: { error: "unreachable" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("errors.unreachable")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "errors.retry" })).toBeInTheDocument();
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

  // (a) Real re-sync ordering: the prior run left a `completed` job row. On
  // mount the resume-probe reads that terminal row and stays idle. The click
  // then starts a FRESH run whose first poll is non-terminal (the backend reset
  // the row to `pending`/`running` before the 202), so progress must appear and
  // polling must continue until the NEW run completes. Against the un-fixed
  // frontend (no mount probe) the re-sync's own first poll latches onto the
  // stale `completed` and stops instantly — this test is RED there.
  it("(a) re-syncs an album whose prior run completed and polls the fresh run to completion", async () => {
    getImportJob
      .mockResolvedValueOnce({
        job: {
          status: "completed",
          totalAssets: 2,
          processedAssets: 2,
          failedAssets: 0,
          error: null,
        },
      }) // mount resume-probe: the previous run's terminal row
      .mockResolvedValueOnce({
        job: {
          status: "running",
          totalAssets: 2,
          processedAssets: 1,
          failedAssets: 0,
          error: null,
        },
      }) // first poll of the fresh run (row was reset before the 202)
      .mockResolvedValue({
        job: {
          status: "completed",
          totalAssets: 2,
          processedAssets: 2,
          failedAssets: 0,
          error: null,
        },
      }); // fresh run finished

    const user = userEvent.setup();
    render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);
    await waitFor(() => expect(getAlbumAssets).toHaveBeenCalled());

    // The mount probe read the prior `completed` and did NOT start a poller.
    await waitFor(() => expect(getImportJob).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("albums.resyncing")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "albums.resync" }));

    await waitFor(() => expect(resyncAlbum).toHaveBeenCalledWith("trip-1", "link-2"));
    await waitFor(() => expect(screen.getByText("albums.resyncing")).toBeInTheDocument());
    await waitFor(
      () => expect(screen.getByRole("button", { name: "albums.resync" })).toBeEnabled(),
      { timeout: 4000 }
    );
  });

  // (b) Owner-decided: resume polling on mount. An import is already running
  // (reload mid-sync). No click — the mount probe alone starts the poller,
  // shows progress, and stops on completion. RED on the un-fixed frontend.
  it("(b) resumes polling on mount when an import is already running", async () => {
    getImportJob
      .mockResolvedValueOnce({
        job: {
          status: "running",
          totalAssets: 2,
          processedAssets: 1,
          failedAssets: 0,
          error: null,
        },
      }) // mount probe
      .mockResolvedValueOnce({
        job: {
          status: "running",
          totalAssets: 2,
          processedAssets: 1,
          failedAssets: 0,
          error: null,
        },
      }) // first poll
      .mockResolvedValue({
        job: {
          status: "completed",
          totalAssets: 2,
          processedAssets: 2,
          failedAssets: 0,
          error: null,
        },
      }); // completes

    render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("albums.resyncing")).toBeInTheDocument());
    expect(resyncAlbum).not.toHaveBeenCalled();
    await waitFor(
      () => expect(screen.getByRole("button", { name: "albums.resync" })).toBeEnabled(),
      { timeout: 4000 }
    );
  });

  // (c) The mount probe must NOT start a poller for a terminal or absent job.
  it("(c) does not start a poller on mount when the job is terminal or absent", async () => {
    getImportJob.mockResolvedValue({
      job: {
        status: "completed",
        totalAssets: 2,
        processedAssets: 2,
        failedAssets: 0,
        error: null,
      },
    });
    const { unmount } = render(
      <ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />
    );
    await waitFor(() => expect(getImportJob).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("albums.resyncing")).not.toBeInTheDocument();
    // A poller would have fired an immediate second getImportJob; it did not.
    expect(getImportJob).toHaveBeenCalledTimes(1);
    unmount();

    // Absent job row: same — idle.
    vi.clearAllMocks();
    getAlbumAssets.mockResolvedValue({ assets: ASSETS });
    getImportJob.mockResolvedValue({ job: null });
    render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);
    await waitFor(() => expect(getImportJob).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("albums.resyncing")).not.toBeInTheDocument();
    expect(getImportJob).toHaveBeenCalledTimes(1);
  });

  // (d) Unmounting mid-sync must clear the poll interval — no leak, no
  // setState-after-unmount.
  it("(d) clears the poll interval when unmounted mid-sync", async () => {
    vi.useFakeTimers();
    try {
      const clearSpy = vi.spyOn(globalThis, "clearInterval");
      getImportJob.mockResolvedValue({
        job: {
          status: "running",
          totalAssets: 2,
          processedAssets: 1,
          failedAssets: 0,
          error: null,
        },
      });
      const { unmount } = render(
        <ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />
      );
      // Flush mount effects: getAlbumAssets + probe -> startPolling -> immediate poll.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1500); // one interval tick
      const callsBefore = getImportJob.mock.calls.length;
      expect(callsBefore).toBeGreaterThan(1); // probe + poll => interval is live

      clearSpy.mockClear();
      unmount();
      expect(clearSpy).toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1500 * 3);
      expect(getImportJob.mock.calls.length).toBe(callsBefore); // no polling after unmount
    } finally {
      vi.useRealTimers();
    }
  });

  // (e) StrictMode double-mounts every component in dev (main.tsx wraps the app
  // in <StrictMode>): setup -> cleanup -> setup. If the mounted-guard ref is only
  // set false in cleanup and never reset true in setup, the second mount runs
  // with the ref stuck false and every setState-guarded continuation bails out —
  // load() resolves but setAssets never fires, so the grid renders EMPTY with no
  // error. This is exactly the state the pending `npm run dev` smoke test runs in.
  it("(e) renders photos under StrictMode (double-mount must not silence the section)", async () => {
    render(
      <StrictMode>
        <ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />
      </StrictMode>
    );

    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
  });

  // (f) The mount-probe effect re-runs when its deps change (album.mode flips on
  // the same section instance). Its cleanup must stop any interval it started,
  // otherwise the old poller leaks and keeps ticking forever.
  it("(f) clears the poll interval when the mount-probe effect re-runs", async () => {
    vi.useFakeTimers();
    try {
      const clearSpy = vi.spyOn(globalThis, "clearInterval");
      getImportJob.mockResolvedValue({
        job: {
          status: "running",
          totalAssets: 2,
          processedAssets: 1,
          failedAssets: 0,
          error: null,
        },
      });
      const { rerender } = render(
        <ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />
      );
      // Flush mount effects: probe -> startPolling -> the interval is live.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1500);
      expect(getImportJob.mock.calls.length).toBeGreaterThan(1);

      clearSpy.mockClear();
      // Same section instance, mode flips import -> link: the probe effect re-runs.
      rerender(
        <ImmichAlbumSection
          tripId="trip-1"
          album={{ ...IMPORT_ALBUM, mode: "link" }}
          onChanged={vi.fn()}
        />
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(clearSpy).toHaveBeenCalled(); // cleanup stopped the old interval

      const callsAfter = getImportJob.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1500 * 3);
      expect(getImportJob.mock.calls.length).toBe(callsAfter); // interval no longer ticking
    } finally {
      vi.useRealTimers();
    }
  });
});
