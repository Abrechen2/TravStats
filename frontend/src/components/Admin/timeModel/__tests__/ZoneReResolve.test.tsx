import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { API_TIMEOUTS } from "../../../../config/constants";
import { api } from "../../../../lib/api/client";
import type { ZoneReResolveDryRun } from "../../../../types/timeMigrationDraft";
import ZoneReResolve from "../ZoneReResolve";

/**
 * The admin zone re-resolution (ADR 0002, D2): dry run → read → apply with
 * that dry run's id → follow the job. Every step has a way to fail, and each
 * test pins what the admin READS when it does — never axios' "Request failed
 * with status code …", never a success that did not happen.
 */

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const DRY_RUN: ZoneReResolveDryRun = {
  dryRunId: "dry-7",
  createdAt: "2026-09-27T08:00:00.000Z",
  expiresAt: "2026-09-27T09:00:00.000Z",
  scanned: 812,
  changes: [
    {
      table: "flight",
      entityId: "f1",
      parentId: null,
      field: "departure",
      label: "LH 2462 MUC → CPH",
      fromZone: "Europe/Kiev",
      toZone: "Europe/Kyiv",
      at: "2024-05-02T06:10:00.000Z",
      offsetDeltaMinutes: 0,
    },
    {
      table: "place_visit",
      entityId: "v1",
      parentId: "p1",
      field: "visitedAt",
      label: "Pyramiden von Gizeh",
      fromZone: "Africa/Tripoli",
      toZone: "Africa/Cairo",
      at: "2024-05-03T09:00:00.000Z",
      offsetDeltaMinutes: 60,
    },
    {
      table: "trip_stop",
      entityId: "s1",
      parentId: "t1",
      field: "startDate",
      label: "Kathmandu",
      fromZone: "Asia/Kolkata",
      toZone: "Asia/Kathmandu",
      at: "2024-05-04T09:00:00.000Z",
      offsetDeltaMinutes: 15,
    },
  ],
  changesTotal: 3,
  unresolvable: 2,
};

const refused = (status: number, code: string) => ({
  isAxiosError: true,
  message: `Request failed with status code ${status}`,
  response: { status, data: { error: "English prose for a log", code } },
});

type JobAnswer = {
  status: "running" | "succeeded" | "failed";
  result?: unknown;
  progress?: { done: number; total: number };
  error?: { code: string; status: number };
};

function mockJob(states: JobAnswer[]) {
  const queue = [...states];
  return vi.spyOn(api, "get").mockImplementation(((url: string) => {
    if (!url.startsWith("/jobs/")) return Promise.reject(new Error(`unexpected GET ${url}`));
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    return Promise.resolve({
      data: {
        success: true,
        data: {
          id: "job-1",
          kind: "timeZones.reResolve",
          startedAt: "2026-09-27T08:01:00.000Z",
          finishedAt: next.status === "running" ? null : "2026-09-27T08:02:00.000Z",
          status: next.status,
          result: next.result ?? null,
          error: next.error ?? null,
          progress: next.progress ?? null,
        },
      },
    });
  }) as never);
}

async function dryRun(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Probelauf starten" }));
  await screen.findByText("Geprüft: 812 · Zone würde sich ändern: 3");
}

async function confirmApply(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Anwenden" }));
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByText(/3 Einträge bekommen die neue Zone aus dem Probelauf/)
  ).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Anwenden" }));
}

describe("zone re-resolution — dry run, then apply exactly that dry run", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers nothing to apply before a dry run has been read", () => {
    render(<ZoneReResolve />);
    expect(screen.queryByRole("button", { name: "Anwenden" })).not.toBeInTheDocument();
  });

  it("lists every row whose zone would change, with the shift of its local clock", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: DRY_RUN } as never);
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await dryRun(user);

    // The dry run is asked for with a timeout that covers a large scan, not
    // the ten-second default that would report a scan still running as failed.
    expect(post).toHaveBeenCalledWith("/admin/time-zones/re-resolve", undefined, {
      params: { dryRun: true },
      timeout: API_TIMEOUTS.ZONE_RE_RESOLVE_DRY_RUN,
    });
    expect(screen.getByText("Pyramiden von Gizeh")).toBeInTheDocument();
    expect(screen.getByText("Africa/Tripoli")).toBeInTheDocument();
    expect(screen.getByText("Africa/Cairo")).toBeInTheDocument();
    expect(screen.getByText("+1:00 h")).toBeInTheDocument();
    expect(screen.getByText("+0:15 h")).toBeInTheDocument();
    // A rename that moves no clock is shown as such, not as a blank.
    expect(screen.getByText("±0:00 h")).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 Einträge lassen sich keiner Zone zuordnen – sie bleiben, wie sie gespeichert sind."
      )
    ).toBeInTheDocument();
  });

  it("applies with the dry run's id, follows the job and reports what it did", async () => {
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValueOnce({ data: DRY_RUN } as never)
      .mockResolvedValueOnce({ data: { success: true, data: { jobId: "job-1" } } } as never);
    mockJob([
      { status: "running", progress: { done: 1, total: 3 } },
      { status: "succeeded", result: { applied: 2, skipped: 1 } },
    ]);
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await dryRun(user);
    await confirmApply(user);

    expect(post).toHaveBeenLastCalledWith("/admin/time-zones/re-resolve/apply", {
      dryRunId: "dry-7",
    });
    expect(await screen.findByText("1 von 3 Einträgen")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Angewendet: 2 · Übersprungen, weil seit dem Probelauf geändert: 1",
        {},
        { timeout: 5000 }
      )
    ).toBeInTheDocument();
  });

  it("writes nothing when the admin declines the confirmation", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: DRY_RUN } as never);
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await dryRun(user);
    await user.click(screen.getByRole("button", { name: "Anwenden" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Abbrechen" })
    );

    expect(post).toHaveBeenCalledTimes(1); // the dry run only
    expect(screen.getByRole("button", { name: "Anwenden" })).toBeInTheDocument();
  });

  it("says a failed dry run changed nothing — never axios' status line", async () => {
    vi.spyOn(api, "post").mockRejectedValue(refused(500, "INTERNAL"));
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await user.click(screen.getByRole("button", { name: "Probelauf starten" }));

    expect(
      await screen.findByText("Der Probelauf ist fehlgeschlagen. Es wurde nichts geändert.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/status code/)).not.toBeInTheDocument();
    expect(screen.queryByText(/English prose/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anwenden" })).not.toBeInTheDocument();
  });

  it("drops a dry run the server calls stale, so its spent id cannot be sent again", async () => {
    vi.spyOn(api, "post")
      .mockResolvedValueOnce({ data: DRY_RUN } as never)
      .mockRejectedValueOnce(refused(409, "DRY_RUN_STALE"));
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await dryRun(user);
    await confirmApply(user);

    expect(
      await screen.findByText(
        "Seit dem Probelauf haben sich Einträge geändert. Es wurde nichts geschrieben – starte einen neuen Probelauf."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anwenden" })).not.toBeInTheDocument();
  });

  it("reports a failed apply job as failed, with the way forward", async () => {
    vi.spyOn(api, "post")
      .mockResolvedValueOnce({ data: DRY_RUN } as never)
      .mockResolvedValueOnce({ data: { jobId: "job-1" } } as never);
    mockJob([{ status: "failed", error: { code: "INTERNAL", status: 500 } }]);
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await dryRun(user);
    await confirmApply(user);

    expect(
      await screen.findByText(
        "Die Neuzuordnung ist fehlgeschlagen. Ein neuer Probelauf zeigt, was noch offen ist."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Angewendet:/)).not.toBeInTheDocument();
  });

  it("says the outcome is unknown when the server forgets the job — never 'failed'", async () => {
    vi.spyOn(api, "post")
      .mockResolvedValueOnce({ data: DRY_RUN } as never)
      .mockResolvedValueOnce({ data: { jobId: "job-1" } } as never);
    vi.spyOn(api, "get").mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await dryRun(user);
    await confirmApply(user);

    expect(await screen.findByText(/Ob angewendet wurde, ist unbekannt/)).toBeInTheDocument();
    expect(screen.queryByText(/fehlgeschlagen/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anwenden" })).not.toBeInTheDocument();
  });

  it("says there is nothing to apply when no zone would change", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: { ...DRY_RUN, changes: [], changesTotal: 0, unresolvable: 0 },
    } as never);
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await user.click(screen.getByRole("button", { name: "Probelauf starten" }));

    expect(
      await screen.findByText("Keine Zeitzone würde sich ändern. Es gibt nichts anzuwenden.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anwenden" })).not.toBeInTheDocument();
  });

  it("does not read a dry run of the wrong shape as 'nothing would change'", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: { rows: [] } } as never);
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await user.click(screen.getByRole("button", { name: "Probelauf starten" }));

    expect(await screen.findByText(/Die Antwort des Servers hat eine Form/)).toBeInTheDocument();
    expect(screen.queryByText(/Keine Zeitzone würde sich ändern/)).not.toBeInTheDocument();
  });
});
