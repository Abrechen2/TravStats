import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const caps = vi.hoisted(() => ({
  current: { version: 1, offered: true, enabled: true, active: true, hasData: true } as {
    version: 1;
    offered: boolean;
    enabled: boolean;
    active: boolean;
    hasData: boolean;
  },
}));
vi.mock("../../../hooks/useTravTrackVisible", () => ({
  useTravTrackCapabilities: () => caps.current,
}));
// The key with its values, so a test can see which count a sentence names.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: {
      language: "en",
      changeLanguage: vi.fn().mockResolvedValue(undefined),
      isInitialized: true,
    },
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: () => true }),
}));
// The trip note reads the home periods on its own; covered by TravTrackTripNote.test.tsx.
vi.mock("../TravTrackTripNote", () => ({ default: () => null }));
vi.mock("../../../hooks/useTodayZone", () => ({
  useTodayZone: () => "UTC",
  todayZoneNow: () => "UTC",
}));

import TravTrackSection from "../TravTrackSection";
import { travTrackApi } from "../../../lib/api/travtrack";
import { travTrackImportsApi } from "../../../lib/api/travtrackImports";
import { api } from "../../../lib/api/client";
import { travTrackMonthsApi } from "../../../lib/api/travtrackMonths";
import {
  dawarichCopyApi,
  dawarichCopyErrorKey,
  type DawarichCopy,
  type DawarichCopyMonth,
} from "../../../lib/api/travtrackDawarichCopy";

/**
 * "Dawarich-Verlauf übernehmen" in Settings (TravTrack plan L6): a copy is
 * started by the user — the whole history or a span — its progress shows
 * while it runs, it pauses and resumes, and an incomplete copy names the
 * hours and days it could not get instead of reading "fertig". Without an own
 * connection there is nothing to start, and a refusal reads as its sentence.
 */

const EMPTY = {
  pointCount: 0,
  firstAt: null,
  lastAt: null,
  lastReceivedAt: null,
  devices: [],
  deletedRanges: 0,
  zones: 0,
};

const dropped = { privacy_zone: 0, deleted_range: 0, invalid: 0, null_island: 0 };

const month = (m: Partial<DawarichCopyMonth> & { month: string }): DawarichCopyMonth => ({
  read: 0,
  stored: 0,
  duplicate: 0,
  dropped,
  truncatedHours: [],
  unreachableDays: [],
  daysWithPoints: 0,
  ...m,
});

const copyOf = (c: Partial<DawarichCopy>): DawarichCopy => ({
  importId: "imp-dw",
  status: "complete",
  fromDay: "2026-03-01",
  untilDay: "2026-04-30",
  nextDay: "2026-05-01",
  daysDone: 61,
  daysTotal: 61,
  lastErrorKind: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  finishedAt: null,
  totals: {
    read: 120,
    stored: 100,
    duplicate: 12,
    dropped: { ...dropped, privacy_zone: 8 },
    truncatedHours: 0,
    unreachableDays: 0,
    daysWithPoints: 40,
  },
  months: [],
  ...c,
});

const show = () =>
  render(
    <MemoryRouter>
      <TravTrackSection />
    </MemoryRouter>
  );

describe("TravTrackSection — copying the Dawarich history", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    caps.current = { version: 1, offered: true, enabled: true, active: true, hasData: true };
    vi.spyOn(travTrackApi, "summary").mockResolvedValue(EMPTY);
    vi.spyOn(travTrackMonthsApi, "cityLookup").mockResolvedValue(false);
    vi.spyOn(travTrackApi, "zones").mockResolvedValue([]);
    vi.spyOn(travTrackImportsApi, "list").mockResolvedValue([]);
  });

  it("without an own connection says so and offers nothing to start", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue({ connection: "none", copy: null });
    show();
    expect(await screen.findByText("track:dawarichCopy.connection.none")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "track:dawarichCopy.start" })).toBeNull();
  });

  it("with only the server's connection explains that a copy reads only the own one", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue({ connection: "shared", copy: null });
    show();
    expect(await screen.findByText("track:dawarichCopy.connection.shared")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "track:dawarichCopy.start" })).toBeNull();
  });

  it("starts the whole history, or the span of days chosen", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue({ connection: "own", copy: null });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { jobId: "j", importId: "i" } });
    show();
    await userEvent.click(await screen.findByRole("button", { name: "track:dawarichCopy.start" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/travtrack/imports/dawarich", {}));
    await userEvent.click(screen.getByLabelText("track:dawarichCopy.span"));
    const start = screen.getByRole("button", { name: "track:dawarichCopy.start" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("track:dawarichCopy.from"), "2024-01-01");
    await userEvent.type(screen.getByLabelText("track:dawarichCopy.until"), "2024-12-31");
    await userEvent.click(start);
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith("/travtrack/imports/dawarich", {
        fromDay: "2024-01-01",
        untilDay: "2024-12-31",
      })
    );
  });

  it("shows a running copy's progress, and pauses it", async () => {
    vi.spyOn(dawarichCopyApi, "get")
      .mockResolvedValueOnce({
        connection: "own",
        copy: copyOf({ status: "running", daysDone: 12, daysTotal: 61, nextDay: "2026-03-13" }),
      })
      .mockResolvedValue({
        connection: "own",
        copy: copyOf({ status: "paused", nextDay: "2026-03-13" }),
      });
    const stop = vi.spyOn(dawarichCopyApi, "stop").mockResolvedValue({
      connection: "own",
      copy: copyOf({ status: "paused", nextDay: "2026-03-13" }),
    });
    const resume = vi.spyOn(dawarichCopyApi, "resume").mockResolvedValue(undefined);
    show();
    expect(
      await screen.findByText(/track:dawarichCopy.status.running \{"done":12,"total":61\}/)
    ).toBeTruthy();
    // No second copy while one runs.
    expect(screen.queryByRole("button", { name: "track:dawarichCopy.start" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "track:dawarichCopy.stop" }));
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/track:dawarichCopy.status.paused \{"day":"2026-03-13"\}/)
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "track:dawarichCopy.resume" }));
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
  });

  it("a paused copy offers resume, not a new copy, and says so", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue({
      connection: "own",
      copy: copyOf({ status: "paused" }),
    });
    show();
    expect(await screen.findByRole("button", { name: "track:dawarichCopy.resume" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "track:dawarichCopy.start" })).toBeNull();
    expect(screen.getByText("track:dawarichCopy.errors.paused")).toBeTruthy();
  });

  it("a refused start because of a paused copy reads as its sentence", () => {
    expect(
      dawarichCopyErrorKey({
        response: { status: 409, data: { error: "x", code: "TRAVTRACK_IMPORT_PAUSED" } },
      })
    ).toBe("track:dawarichCopy.errors.paused");
  });

  it("a paused copy names why it paused", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue({
      connection: "own",
      copy: copyOf({ status: "paused", lastErrorKind: "unreachable" }),
    });
    show();
    const line = await screen.findByText(/track:dawarichCopy.status.paused/);
    expect(line.textContent).toContain("track:dawarichCopy.reason.unreachable");
  });

  it("an incomplete copy lists the hours and days it could not get, with the totals", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue({
      connection: "own",
      copy: copyOf({
        status: "incomplete",
        months: [
          month({ month: "2026-03", stored: 60 }),
          month({
            month: "2026-04",
            stored: 40,
            truncatedHours: ["2026-04-02T05:00Z"],
            unreachableDays: ["2026-04-07", "2026-04-08"],
          }),
        ],
      }),
    });
    show();
    expect(await screen.findByText(/track:dawarichCopy.status.incomplete/)).toBeTruthy();
    const totals = screen.getByText(/track:dawarichCopy.report.read \{"count":120\}/);
    expect(totals.textContent).toContain('track:dawarichCopy.report.stored {"count":100}');
    expect(totals.textContent).toContain('track:dawarichCopy.report.duplicate {"count":12}');
    expect(totals.textContent).toContain('track:dawarichCopy.report.zone {"count":8}');
    const gaps = screen.getByRole("list", { name: "track:dawarichCopy.gaps.title" });
    expect(gaps.textContent).toContain("2026-04");
    expect(gaps.textContent).not.toContain("2026-03");
    expect(gaps.textContent).toContain('"list":"2026-04-02T05:00Z"');
    expect(gaps.textContent).toContain('"list":"2026-04-07, 2026-04-08"');
  });

  it("a refused start reads as its sentence", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue({ connection: "own", copy: null });
    vi.spyOn(api, "post").mockRejectedValue({
      response: { status: 409, data: { error: "x", code: "TRAVTRACK_IMPORT_RUNNING" } },
    });
    show();
    await userEvent.click(await screen.findByRole("button", { name: "track:dawarichCopy.start" }));
    expect(await screen.findByText("track:dawarichCopy.errors.running")).toBeTruthy();
  });

  it("with TravTrack off the copy stays readable, and nothing starts or resumes", async () => {
    caps.current = { ...caps.current, enabled: false };
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue({
      connection: "own",
      copy: copyOf({ status: "paused" }),
    });
    show();
    expect(await screen.findByText(/track:dawarichCopy.status.paused/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "track:dawarichCopy.start" })).toBeNull();
    expect(screen.queryByRole("button", { name: "track:dawarichCopy.resume" })).toBeNull();
  });
});
