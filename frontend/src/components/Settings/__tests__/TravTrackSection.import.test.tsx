import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
import {
  storedImportErrorKey,
  travTrackImportsApi,
  type TravTrackImport,
} from "../../../lib/api/travtrackImports";
import { travTrackMonthsApi } from "../../../lib/api/travtrackMonths";
import { api } from "../../../lib/api/client";
import { JobFailedError } from "../../../lib/api/jobs";

/**
 * GPX files into TravTrack, in Settings (TravTrack plan E8): the file goes up
 * as multipart, the outcome is the job's and reads as a report, a failure
 * reads as its own sentence, and deleting an import names how many positions
 * go with it first.
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

const REPORT = {
  read: 120,
  stored: 100,
  duplicate: 12,
  dropped: { privacy_zone: 5, deleted_range: 2, invalid: 1, null_island: 0 },
  withoutTime: 3,
};

const DONE: TravTrackImport = {
  id: "imp-1",
  kind: "gpx",
  fileName: "Bukhansan.gpx",
  status: "succeeded",
  report: REPORT,
  pointCount: 42,
  fromAt: "2026-10-12T01:00:00.000Z",
  toAt: "2026-10-12T05:00:00.000Z",
  createdAt: "2026-10-20T10:00:00.000Z",
  finishedAt: "2026-10-20T10:00:05.000Z",
};

const show = () =>
  render(
    <MemoryRouter>
      <TravTrackSection />
    </MemoryRouter>
  );

const gpx = () => new File(["<gpx/>"], "walk.gpx", { type: "application/gpx+xml" });

async function confirmInDialog() {
  const dialog = await screen.findByRole("dialog");
  const buttons = within(dialog).getAllByRole("button");
  await userEvent.click(buttons[buttons.length - 1]);
}

describe("TravTrackSection — GPX import", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    caps.current = { version: 1, offered: true, enabled: true, active: true, hasData: true };
    vi.spyOn(travTrackApi, "summary").mockResolvedValue(EMPTY);
    vi.spyOn(travTrackApi, "zones").mockResolvedValue([]);
    vi.spyOn(travTrackImportsApi, "list").mockResolvedValue([]);
    vi.spyOn(travTrackMonthsApi, "cityLookup").mockResolvedValue(false);
  });

  it("uploads the file as multipart and waits for the job", async () => {
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValue({ data: { jobId: "job-1", importId: "imp-1" } });
    vi.spyOn(api, "get").mockResolvedValue({
      data: {
        success: true,
        data: {
          id: "job-1",
          status: "succeeded",
          result: { importId: "imp-1", status: "succeeded", report: REPORT },
        },
      },
    });
    const outcome = await travTrackImportsApi.importGpx(gpx());
    expect(outcome.report.stored).toBe(100);
    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe("/travtrack/imports");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("file")).toBeInstanceOf(File);
    expect(config).toEqual({ headers: { "Content-Type": "multipart/form-data" } });
  });

  it("imports a chosen file and reports what was stored and what was dropped", async () => {
    const importGpx = vi
      .spyOn(travTrackImportsApi, "importGpx")
      .mockResolvedValue({ importId: "imp-1", status: "succeeded", report: REPORT });
    show();
    await userEvent.upload(await screen.findByLabelText("track:imports.choose"), gpx());
    await waitFor(() => expect(importGpx).toHaveBeenCalledTimes(1));
    const status = await screen.findByText(/track:imports.report.stored \{"count":100\}/);
    expect(status.textContent).toContain('track:imports.report.duplicate {"count":12}');
    expect(status.textContent).toContain('track:imports.report.zone {"count":5}');
    expect(status.textContent).toContain('track:imports.report.deleted {"count":2}');
    expect(status.textContent).toContain('track:imports.report.invalid {"count":1}');
    expect(status.textContent).toContain('track:imports.report.withoutTime {"count":3}');
  });

  it("a file without times says so", async () => {
    vi.spyOn(travTrackImportsApi, "importGpx").mockRejectedValue(
      new JobFailedError("TRAVTRACK_IMPORT_NO_TIMES", 422)
    );
    show();
    await userEvent.upload(await screen.findByLabelText("track:imports.choose"), gpx());
    expect(await screen.findByRole("alert")).toHaveTextContent("track:imports.errors.noTimes");
  });

  it("a file over the point cap says so, live and in the list", async () => {
    vi.spyOn(travTrackImportsApi, "importGpx").mockRejectedValue(
      new JobFailedError("TRAVTRACK_IMPORT_TOO_MANY_POINTS", 422)
    );
    show();
    await userEvent.upload(await screen.findByLabelText("track:imports.choose"), gpx());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "track:imports.errors.tooManyPoints"
    );
    expect(storedImportErrorKey("TRAVTRACK_IMPORT_TOO_MANY_POINTS")).toBe(
      "track:imports.errors.tooManyPoints"
    );
  });

  it("an import already running says so", async () => {
    vi.spyOn(travTrackImportsApi, "importGpx").mockRejectedValue({
      response: { status: 409, data: { code: "TRAVTRACK_IMPORT_RUNNING" } },
    });
    show();
    await userEvent.upload(await screen.findByLabelText("track:imports.choose"), gpx());
    expect(await screen.findByRole("alert")).toHaveTextContent("track:imports.errors.running");
  });

  it("a finished import keeps its report in the list after a reload", async () => {
    vi.spyOn(travTrackImportsApi, "list").mockResolvedValue([DONE]);
    show();
    const row = (await screen.findByText("Bukhansan.gpx")).closest("li")!;
    expect(row.textContent).toContain('track:imports.report.stored {"count":100}');
    expect(row.textContent).toContain('track:imports.report.duplicate {"count":12}');
    expect(row.textContent).toContain('track:imports.report.zone {"count":5}');
    expect(row.textContent).toContain('track:imports.report.withoutTime {"count":3}');
  });

  it("lists the imports and deletes one only after naming its point count", async () => {
    vi.spyOn(travTrackImportsApi, "list").mockResolvedValue([
      DONE,
      {
        ...DONE,
        id: "imp-2",
        fileName: "plan.gpx",
        status: "failed",
        pointCount: 0,
        report: { ...REPORT, stored: 0, error: "TRAVTRACK_IMPORT_NO_TIMES" },
      },
    ]);
    const remove = vi.spyOn(travTrackImportsApi, "remove").mockResolvedValue(42);
    show();
    const row = (await screen.findByText("Bukhansan.gpx")).closest("li")!;
    expect(within(row).getByText(/track:imports.points \{"count":42\}/)).toBeInTheDocument();
    const failed = screen.getByText("plan.gpx").closest("li")!;
    expect(within(failed).getByText("track:imports.errors.noTimes")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "track:imports.delete" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent('"count":42');
    await confirmInDialog();
    await waitFor(() => expect(remove).toHaveBeenCalledWith("imp-1"));
    expect(await screen.findByText(/track:imports.deleted \{"count":42\}/)).toBeInTheDocument();
  });

  it("with TravTrack off there is no import, but an import can still be deleted", async () => {
    caps.current = { ...caps.current, enabled: false };
    vi.spyOn(travTrackImportsApi, "list").mockResolvedValue([DONE]);
    show();
    expect(await screen.findByText("Bukhansan.gpx")).toBeInTheDocument();
    expect(screen.queryByLabelText("track:imports.choose")).toBeNull();
    expect(screen.getByRole("button", { name: "track:imports.delete" })).toBeInTheDocument();
  });
});
