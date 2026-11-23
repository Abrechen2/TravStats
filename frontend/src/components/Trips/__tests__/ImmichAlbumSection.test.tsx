import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.hoisted lets these vi.fn()s survive vi.mock factory hoisting and stay
// reachable from the test bodies below (see ImmichConnectionCard.test.tsx).
const { getAlbumDays, getAlbumDayAssets, unlinkAlbum, resyncAlbum, getImportJob } = vi.hoisted(
  () => ({
    getAlbumDays: vi.fn(),
    getAlbumDayAssets: vi.fn(),
    unlinkAlbum: vi.fn(),
    resyncAlbum: vi.fn(),
    getImportJob: vi.fn(),
  })
);
const KNOWN_FAILURE_KINDS = [
  "notConfigured",
  "unreachable",
  "auth",
  "notFound",
  "protocol",
  "invalidUrl",
];
vi.mock("../../../lib/api/immich", () => ({
  immichApi: { getAlbumDays, getAlbumDayAssets, unlinkAlbum, resyncAlbum, getImportJob },
  immichFailureKind: (e: unknown) =>
    (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null,
  failureKey: (kind: unknown, provider = "immich") => {
    const prefix = provider === "photoprism" ? "errors.photoprism" : "errors";
    return typeof kind === "string" && KNOWN_FAILURE_KINDS.includes(kind)
      ? `${prefix}.${kind}`
      : `${prefix}.unknown`;
  },
}));

const translated = vi.hoisted(() => [] as string[]);
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      translated.push(key);
      return key;
    },
    i18n: {},
    ready: true,
  }),
}));

vi.mock("../PhotoLightbox", () => ({ default: () => <div data-testid="lightbox" /> }));

import ImmichAlbumSection from "../ImmichAlbumSection";
import type { LinkedAlbum } from "../../../types/immich";

/** The album's ⋯ holds re-sync and unlink; open it once, whichever test asks first. */
function openAlbumMenu(): void {
  if (!screen.queryByRole("menu")) fireEvent.click(screen.getByTestId("album-menu"));
}
function menuItem(name: string): HTMLElement {
  openAlbumMenu();
  return screen.getByRole("menuitem", { name });
}
function queryMenuItem(name: string): HTMLElement | null {
  openAlbumMenu();
  return screen.queryByRole("menuitem", { name });
}

const LINK_ALBUM: LinkedAlbum = {
  id: "link-1",
  provider: "immich",
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

interface Asset {
  id: string;
  url: string;
  previewUrl: string;
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
}

/** Stand in for the server: counts per UTC day, and a day's photos on request. */
function serve(assets: Asset[], truncated = false): void {
  const dayOf = (a: Asset): string | null => (a.takenAt ? a.takenAt.slice(0, 10) : null);
  const keys = [...new Set(assets.map(dayOf))];
  const ordered = [...keys.filter((k) => k !== null).sort(), ...keys.filter((k) => k === null)];
  getAlbumDays.mockResolvedValue({
    zone: "UTC",
    truncated,
    total: assets.length,
    days: ordered.map((day) => ({ day, count: assets.filter((a) => dayOf(a) === day).length })),
  });
  getAlbumDayAssets.mockImplementation(async (_t: string, _l: string, day: string) => {
    const of = assets.filter((a) => day === "all" || (dayOf(a) ?? "undated") === day);
    return { day, total: of.length, offset: 0, nextOffset: null, assets: of };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The day-grouping preference lives in localStorage, which jsdom keeps
  // across tests in a file — without this, a test that switches grouping OFF
  // silently decides the starting state of every test after it.
  localStorage.clear();
  serve(ASSETS);
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
    expect(queryMenuItem("albums.resync")).not.toBeInTheDocument();
  });

  /* ── Day grouping (#154) ────────────────────────────────────────────────
     Alex asked for the photos to follow the journey and to be divided into
     days by a header, with the grouping optional. */

  const DATED = [
    {
      id: "d1",
      url: "/1.jpg",
      previewUrl: "/1.jpg",
      takenAt: "2026-05-01T12:00:00.000Z",
      lat: null,
      lon: null,
    },
    {
      id: "d2",
      url: "/2.jpg",
      previewUrl: "/2.jpg",
      takenAt: "2026-05-01T15:00:00.000Z",
      lat: null,
      lon: null,
    },
    {
      id: "d3",
      url: "/3.jpg",
      previewUrl: "/3.jpg",
      takenAt: "2026-05-02T12:00:00.000Z",
      lat: null,
      lon: null,
    },
  ];

  it("opens on the first day only: a day strip with counts, and just that day's pictures", async () => {
    serve(DATED);
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    // "Alle" + two capture days, each with its count; the third picture (day 2) is NOT loaded.
    const chips = screen.getAllByTestId("gallery-day-chip");
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent("3");
    expect(chips[1]).toHaveTextContent("2");
    expect(chips[2]).toHaveTextContent("1");
    expect(getAlbumDayAssets).toHaveBeenCalledTimes(1);
    expect(getAlbumDayAssets.mock.calls[0][2]).toBe("2026-05-01");
  });

  it("loads only the chosen day when the user switches, and remembers it for the trip", async () => {
    serve(DATED);
    const { unmount } = render(
      <ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />
    );
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));

    await userEvent.click(screen.getAllByTestId("gallery-day-chip")[2]);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(1));
    expect(getAlbumDayAssets.mock.calls.map((c) => c[2])).toEqual(["2026-05-01", "2026-05-02"]);
    unmount();

    // Next visit starts on the day the user left on, not on the first one.
    getAlbumDayAssets.mockClear();
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(1));
    expect(getAlbumDayAssets.mock.calls[0][2]).toBe("2026-05-02");
  });

  it('"Alle" shows every picture under a header per day, paged from the server', async () => {
    serve(DATED);
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));

    await userEvent.click(screen.getAllByTestId("gallery-day-chip")[0]);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(3));
    expect(screen.getAllByTestId("gallery-day-header")).toHaveLength(2);
    expect(getAlbumDayAssets.mock.calls[getAlbumDayAssets.mock.calls.length - 1][2]).toBe("all");
  });

  it("offers a next page of a long day and appends it", async () => {
    serve(DATED);
    getAlbumDayAssets.mockImplementation(
      async (_t: string, _l: string, day: string, off: number) =>
        off === 0
          ? { day, total: 3, offset: 0, nextOffset: 2, assets: DATED.slice(0, 2) }
          : { day, total: 3, offset: 2, nextOffset: null, assets: DATED.slice(2) }
    );
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "albums.loadMore" }));
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(3));
    expect(getAlbumDayAssets.mock.calls.map((c) => c[3])).toEqual([0, 2]);
  });

  it("says why a day could not be loaded instead of showing an empty grid", async () => {
    serve(DATED);
    getAlbumDayAssets.mockRejectedValue({ response: { data: { error: "unreachable" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("errors.unreachable");
    expect(screen.getByRole("button", { name: "errors.retry" })).toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("puts photos without a capture date in their own last chip, named as undated (not 1970)", async () => {
    const undated = {
      id: "u1",
      url: "/u.jpg",
      previewUrl: "/u.jpg",
      takenAt: null,
      lat: null,
      lon: null,
    };
    serve([...DATED, undated]);
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByTestId("gallery-day-chip")).toHaveLength(4));
    const chips = screen.getAllByTestId("gallery-day-chip");
    expect(chips[3]).toHaveTextContent("albums.undated");
    await userEvent.click(chips[3]);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(1));
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

  it("lets the grouping be turned off, showing one plain grid again", async () => {
    serve(DATED);
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByTestId("gallery-day-chip")).toHaveLength(3));
    await userEvent.click(screen.getByRole("switch", { name: "albums.groupByDay" }));

    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(3));
    expect(screen.queryByTestId("gallery-day-chip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("gallery-day-header")).not.toBeInTheDocument();
  });

  it("offers the grouping as a switch that reports its state, not a text link", async () => {
    // Alex on the rc.4 UAT: it was an underlined text link, which reads as
    // navigation and never says whether grouping is currently on. The active-
    // domains setting already establishes the switch pattern.
    serve(DATED);
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    const sw = await screen.findByRole("switch", { name: "albums.groupByDay" });
    expect(sw).toHaveAttribute("aria-checked", "true");

    await userEvent.click(sw);
    expect(screen.getByRole("switch", { name: "albums.groupByDay" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  it("shows no day header at all when the album carries no capture dates", async () => {
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(screen.queryByTestId("gallery-day-header")).not.toBeInTheDocument();
  });

  it("hides the grouping toggle when there is nothing to group by", async () => {
    // ASSETS carry takenAt: null. A toggle that cannot change anything is the
    // "button that does nothing" Alex complained about before.
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(screen.queryByRole("switch", { name: "albums.groupByDay" })).not.toBeInTheDocument();
  });

  it("shows a copy badge and a re-sync button for import mode", async () => {
    render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("albums.badgeImport")).toBeInTheDocument());
    expect(menuItem("albums.resync")).toBeInTheDocument();
  });

  it("labels the group with its photo source", async () => {
    const { rerender } = render(
      <ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />
    );
    await waitFor(() =>
      expect(screen.getByTestId("album-source")).toHaveTextContent("albums.badgeImmich")
    );
    rerender(
      <ImmichAlbumSection
        tripId="trip-1"
        album={{ ...LINK_ALBUM, provider: "photoprism" }}
        onChanged={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId("album-source")).toHaveTextContent("albums.badgePhotoprism")
    );
  });

  it("names PhotoPrism, not Immich, when a PhotoPrism album rejects the app password", async () => {
    getAlbumDays.mockRejectedValue({ response: { data: { error: "auth" } } });
    render(
      <ImmichAlbumSection
        tripId="trip-1"
        album={{ ...LINK_ALBUM, provider: "photoprism" }}
        onChanged={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText("errors.photoprism.auth")).toBeInTheDocument());
    expect(screen.queryByText("errors.auth")).not.toBeInTheDocument();
  });

  it("renders a degraded panel instead of tiles when Immich is unreachable", async () => {
    getAlbumDays.mockRejectedValue({ response: { data: { error: "unreachable" } } });
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
    getAlbumDays.mockRejectedValue({ response: { data: { error: "brand-new-kind" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("errors.unknown")).toBeInTheDocument());
    expect(screen.queryByText("errors.unreachable")).not.toBeInTheDocument();
  });

  it("offers unlink for a deleted album", async () => {
    getAlbumDays.mockRejectedValue({ response: { data: { error: "notFound" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("errors.notFound")).toBeInTheDocument());
    expect(menuItem("albums.unlink")).toBeInTheDocument();
  });

  // Regression guard for the `failure !== "errors.notFound"` check on line ~220:
  // that literal must keep the "errors." prefix in sync with the full i18n key
  // now stored in `failure` (it used to compare against the bare kind
  // "notFound"). Without this test, dropping the prefix again would make the
  // retry button reappear for a deleted album — a useless "Try again" click,
  // since re-fetching a permanently-gone album can never succeed — while every
  // other test still passes.
  it("does NOT render a retry button when the album was not found (permanent failure)", async () => {
    getAlbumDays.mockRejectedValue({ response: { data: { error: "notFound" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("errors.notFound")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "errors.retry" })).not.toBeInTheDocument();
  });

  it("DOES render a retry button for a retryable failure (unreachable)", async () => {
    getAlbumDays.mockRejectedValue({ response: { data: { error: "unreachable" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("errors.unreachable")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "errors.retry" })).toBeInTheDocument();
  });

  it("unlinks a link-mode album without asking about copies", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={onChanged} />);
    await waitFor(() => expect(getAlbumDays).toHaveBeenCalled());

    await user.click(menuItem("albums.unlink"));

    await waitFor(() => expect(unlinkAlbum).toHaveBeenCalledWith("trip-1", "link-1", false));
    expect(onChanged).toHaveBeenCalled();
  });

  it("asks whether to delete the copies when unlinking an import-mode album", async () => {
    const user = userEvent.setup();
    render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);
    await waitFor(() => expect(getAlbumDays).toHaveBeenCalled());

    await user.click(menuItem("albums.unlink"));
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
    await waitFor(() => expect(getAlbumDays).toHaveBeenCalled());

    // The mount probe read the prior `completed` and did NOT start a poller.
    await waitFor(() => expect(getImportJob).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("albums.resyncing")).not.toBeInTheDocument();

    await user.click(menuItem("albums.resync"));

    await waitFor(() => expect(resyncAlbum).toHaveBeenCalledWith("trip-1", "link-2"));
    await waitFor(() => expect(screen.getByText("albums.resyncing")).toBeInTheDocument());
    await waitFor(() => expect(menuItem("albums.resync")).toBeEnabled(), { timeout: 4000 });
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
    await waitFor(() => expect(menuItem("albums.resync")).toBeEnabled(), { timeout: 4000 });
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
    serve(ASSETS);
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
      // Flush mount effects: getAlbumDays + probe -> startPolling -> immediate poll.
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
  // An import that failed, or left photos behind, used to end silently: the
  // button simply became clickable again.
  describe("says how a finished import ended", () => {
    const job = (over: Record<string, unknown>) => ({
      job: {
        status: "running",
        totalAssets: 3,
        processedAssets: 1,
        failedAssets: 0,
        error: null,
        ...over,
      },
    });

    it("reports a failed run", async () => {
      getImportJob
        .mockResolvedValueOnce(job({})) // mount probe: running
        .mockResolvedValue(job({ status: "failed", error: "unreachable" }));

      render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);

      expect(
        await screen.findByText("albums.importFailed", undefined, { timeout: 4000 })
      ).toBeInTheDocument();
    });

    it("names the source in a failed PhotoPrism import (its words, not Immich's)", async () => {
      translated.length = 0;
      getImportJob
        .mockResolvedValueOnce(job({}))
        .mockResolvedValue(job({ status: "failed", error: "auth" }));

      render(
        <ImmichAlbumSection
          tripId="trip-1"
          album={{ ...IMPORT_ALBUM, provider: "photoprism" }}
          onChanged={vi.fn()}
        />
      );

      await screen.findByText("albums.importFailed", undefined, { timeout: 4000 });
      expect(translated).toContain("errors.photoprism.auth");
      expect(translated).not.toContain("errors.auth");
    });

    it("says a completed run was cut short because the album is too large", async () => {
      getImportJob
        .mockResolvedValueOnce(job({}))
        .mockResolvedValue(
          job({ status: "completed", error: "truncated:100000", processedAssets: 3 })
        );

      render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);

      expect(
        await screen.findByText("albums.importTruncated", undefined, { timeout: 4000 })
      ).toBeInTheDocument();
    });

    it("reports photos that did not come across in an otherwise completed run", async () => {
      getImportJob
        .mockResolvedValueOnce(job({}))
        .mockResolvedValue(job({ status: "completed", processedAssets: 2, failedAssets: 1 }));

      render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);

      expect(
        await screen.findByText("albums.importPartial", undefined, { timeout: 4000 })
      ).toBeInTheDocument();
    });

    it("says nothing after a clean run", async () => {
      getImportJob
        .mockResolvedValueOnce(job({}))
        .mockResolvedValue(job({ status: "completed", processedAssets: 3 }));

      render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);

      await waitFor(() => expect(menuItem("albums.resync")).toBeEnabled(), { timeout: 4000 });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});

describe("ImmichAlbumSection — a failing import poll (forgejo#375)", () => {
  it("stops polling and shows the failure kind after repeated failed polls instead of syncing forever", async () => {
    const user = userEvent.setup();
    getImportJob.mockReset();
    getImportJob.mockResolvedValueOnce({ job: { status: "completed" } });
    getImportJob.mockRejectedValue({ response: { data: { error: "unreachable" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);
    await waitFor(() => expect(getImportJob).toHaveBeenCalledTimes(1));

    await user.click(menuItem("albums.resync"));

    await waitFor(() => expect(screen.getByText("errors.unreachable")).toBeInTheDocument(), {
      timeout: 6000,
    });
    expect(screen.queryByText("albums.resyncing")).not.toBeInTheDocument();
    const calls = getImportJob.mock.calls.length;
    await new Promise((r) => setTimeout(r, 1800));
    expect(getImportJob.mock.calls.length).toBe(calls);
  }, 15000);

  it("says the gallery shows only a prefix when the album outgrew the paging cap", async () => {
    serve(ASSETS, true);
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(screen.getByTestId("album-truncated")).toHaveTextContent("albums.truncated");
  });

  it("names PhotoPrism, not Immich, in the truncation notice of a PhotoPrism album", async () => {
    serve(ASSETS, true);
    render(
      <ImmichAlbumSection
        tripId="trip-1"
        album={{ ...LINK_ALBUM, provider: "photoprism" }}
        onChanged={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(screen.getByTestId("album-truncated").textContent).toBe("albums.truncatedPhotoprism");
  });

  it("shows no truncation notice for a complete album", async () => {
    serve(ASSETS, false);
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(screen.queryByTestId("album-truncated")).not.toBeInTheDocument();
  });
});
