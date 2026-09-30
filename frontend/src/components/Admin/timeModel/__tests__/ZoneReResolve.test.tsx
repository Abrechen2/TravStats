import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { api } from "../../../../lib/api/client";
import type { ReResolveDryRun } from "../../../../types/timeMigration";
import ZoneReResolve from "../ZoneReResolve";

/**
 * The admin zone re-resolution (ADR 0002, D2): dry run → read → apply with
 * that dry run's id, each a server job the screen follows. Every step has a
 * way to fail, and each test pins what the admin READS when it does — never
 * axios' "Request failed with status code …", never a success that did not
 * happen, never "nothing would change" for an answer it could not read.
 */

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const DRY_RUN: ReResolveDryRun = {
  dryRunId: "5b8c1c2e-8a4f-4c1e-9d55-0f3a4e2b7c11",
  tzdata: "2025b",
  createdAt: "2026-09-27T08:00:00.000Z",
  expiresAt: "2026-09-27T09:00:00.000Z",
  tables: [
    { table: "flights", checked: 700, changes: 1, unresolvable: 0 },
    { table: "place_visits", checked: 100, changes: 1, unresolvable: 2 },
    { table: "trip_stops", checked: 12, changes: 2, unresolvable: 0 },
  ],
  changes: [
    {
      table: "flights",
      rowId: "f1",
      // The columns the server really names: the zone columns (reResolve.ts).
      column: "dep_timezone",
      storedZone: "Europe/Kiev",
      resolvedZone: "Europe/Kyiv",
      instant: "2024-05-02T06:10:00.000Z",
      offsetDeltaMinutes: 0,
    },
    {
      table: "place_visits",
      rowId: "v1",
      column: "visited_zone",
      storedZone: "Africa/Tripoli",
      resolvedZone: "Africa/Cairo",
      instant: "2024-05-03T09:00:00.000Z",
      offsetDeltaMinutes: 60,
    },
    {
      table: "trip_stops",
      rowId: "s1",
      column: "stop_zone",
      storedZone: "Asia/Kolkata",
      resolvedZone: "Asia/Kathmandu",
      instant: "2024-05-04T09:00:00.000Z",
      offsetDeltaMinutes: 15,
    },
  ],
  changesTruncated: true,
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

/** `/jobs/:id` answers each job's states in order; the last one repeats. */
function mockJobs(jobs: Record<string, JobAnswer[]>) {
  const queues = Object.fromEntries(Object.entries(jobs).map(([id, s]) => [id, [...s]]));
  return vi.spyOn(api, "get").mockImplementation(((url: string) => {
    const id = url.replace(/^\/jobs\//, "");
    const queue = queues[id];
    if (!queue) return Promise.reject(new Error(`unexpected GET ${url}`));
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    return Promise.resolve({
      data: {
        success: true,
        data: {
          id,
          kind: "timeZones.reResolveDryRun",
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

/** The two job starts: the dry run, then (optionally) the apply. */
function mockStarts(...answers: Array<{ jobId: string } | ReturnType<typeof refused>>) {
  const post = vi.spyOn(api, "post");
  for (const a of answers) {
    if ("jobId" in a) post.mockResolvedValueOnce({ data: a } as never);
    else post.mockRejectedValueOnce(a);
  }
  return post;
}

async function dryRun(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Probelauf starten" }));
  await screen.findByText(
    "Geprüft: 812 · Zone würde sich ändern: 4 · Zeitzonendaten 2025b",
    {},
    { timeout: 5000 }
  );
}

async function confirmApply(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Anwenden" }));
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByText(/4 Einträge bekommen die neue Zone aus dem Probelauf/)
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

  it("follows the dry-run job and lists every row whose zone would change, with the clock shift", async () => {
    const post = mockStarts({ jobId: "dry" });
    mockJobs({
      dry: [
        { status: "running", progress: { done: 300, total: 812 } },
        { status: "succeeded", result: DRY_RUN },
      ],
    });
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await user.click(screen.getByRole("button", { name: "Probelauf starten" }));

    expect(await screen.findByText("300 von 812 geprüft")).toBeInTheDocument();
    await screen.findByText(
      "Geprüft: 812 · Zone würde sich ändern: 4 · Zeitzonendaten 2025b",
      {},
      { timeout: 5000 }
    );
    expect(post).toHaveBeenCalledWith("/admin/time-zones/re-resolve", undefined, {
      params: { dryRun: "true" },
    });
    expect(screen.getByText("Ortsbesuche · Zeitzone des Besuchs")).toBeInTheDocument();
    expect(screen.getByText("Flüge · Zeitzone Abflug")).toBeInTheDocument();
    expect(screen.getByText("Reise-Halte · Zeitzone des Halts")).toBeInTheDocument();
    expect(screen.queryByText(/unbekannt \(/)).toBeNull();
    expect(screen.getByText("Africa/Tripoli")).toBeInTheDocument();
    expect(screen.getByText("Africa/Cairo")).toBeInTheDocument();
    expect(screen.getByText("+1:00 h")).toBeInTheDocument();
    expect(screen.getByText("+0:15 h")).toBeInTheDocument();
    // A rename that moves no clock is shown as such, not as a blank.
    expect(screen.getByText("±0:00 h")).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 Einträge lassen sich jetzt keiner Zone zuordnen – sie bleiben, wie sie gespeichert sind."
      )
    ).toBeInTheDocument();
    // Capped list: says so, and that every change is applied.
    expect(
      screen.getByText("3 von 4 Änderungen angezeigt. Angewendet werden alle 4.")
    ).toBeInTheDocument();
  });

  it("applies with the dry run's id, follows the job and reports what it did", async () => {
    const post = mockStarts({ jobId: "dry" }, { jobId: "apply" });
    mockJobs({
      dry: [{ status: "succeeded", result: DRY_RUN }],
      apply: [
        { status: "running", progress: { done: 1, total: 4 } },
        {
          status: "succeeded",
          result: { dryRunId: DRY_RUN.dryRunId, applied: 3, skippedChanged: 1 },
        },
      ],
    });
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await dryRun(user);
    await confirmApply(user);

    expect(post).toHaveBeenLastCalledWith(
      "/admin/time-zones/re-resolve/apply",
      { dryRunId: DRY_RUN.dryRunId },
      undefined
    );
    expect(await screen.findByText("1 von 4 geprüft")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Angewendet: 3 · Übersprungen, weil seit dem Probelauf geändert: 1",
        {},
        { timeout: 5000 }
      )
    ).toBeInTheDocument();
  });

  it("writes nothing when the admin declines the confirmation", async () => {
    const post = mockStarts({ jobId: "dry" });
    mockJobs({ dry: [{ status: "succeeded", result: DRY_RUN }] });
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

  it("says a refused dry run changed nothing — never axios' status line", async () => {
    mockStarts(refused(500, "INTERNAL"));
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

  it("says another re-resolution is running when the server says so", async () => {
    mockStarts(refused(409, "RE_RESOLVE_RUNNING"));
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await user.click(screen.getByRole("button", { name: "Probelauf starten" }));

    expect(
      await screen.findByText("Es läuft bereits eine Neuzuordnung. Warte, bis sie fertig ist.")
    ).toBeInTheDocument();
  });

  it("drops a dry run the server no longer knows, so its spent id cannot be sent again", async () => {
    mockStarts({ jobId: "dry" }, refused(404, "DRY_RUN_NOT_FOUND"));
    mockJobs({ dry: [{ status: "succeeded", result: DRY_RUN }] });
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await dryRun(user);
    await confirmApply(user);

    expect(
      await screen.findByText(/Diesen Probelauf kennt der Server nicht mehr/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anwenden" })).not.toBeInTheDocument();
  });

  it("reports a failed apply job as failed, with the way forward", async () => {
    mockStarts({ jobId: "dry" }, { jobId: "apply" });
    mockJobs({
      dry: [{ status: "succeeded", result: DRY_RUN }],
      apply: [{ status: "failed", error: { code: "INTERNAL", status: 500 } }],
    });
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

  it("says the outcome is unknown when the server forgets the apply job — never 'failed'", async () => {
    mockStarts({ jobId: "dry" }, { jobId: "apply" });
    const get = mockJobs({ dry: [{ status: "succeeded", result: DRY_RUN }] });
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await dryRun(user);
    get.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    await confirmApply(user);

    expect(
      await screen.findByText(/Ob etwas geschrieben wurde, ist unbekannt/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/fehlgeschlagen/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anwenden" })).not.toBeInTheDocument();
  });

  it("says there is nothing to apply when no zone would change", async () => {
    mockStarts({ jobId: "dry" });
    mockJobs({
      dry: [
        {
          status: "succeeded",
          result: {
            ...DRY_RUN,
            tables: [{ table: "flights", checked: 700, changes: 0, unresolvable: 0 }],
            changes: [],
            changesTruncated: false,
          },
        },
      ],
    });
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await user.click(screen.getByRole("button", { name: "Probelauf starten" }));

    expect(
      await screen.findByText(
        "Keine Zeitzone würde sich ändern. Es gibt nichts anzuwenden.",
        {},
        { timeout: 5000 }
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anwenden" })).not.toBeInTheDocument();
  });

  it("does not read a dry run of the wrong shape as 'nothing would change'", async () => {
    mockStarts({ jobId: "dry" });
    mockJobs({ dry: [{ status: "succeeded", result: { rows: [] } }] });
    const user = userEvent.setup();
    render(<ZoneReResolve />);
    await user.click(screen.getByRole("button", { name: "Probelauf starten" }));

    expect(
      await screen.findByText(/Die Antwort des Servers hat eine Form/, {}, { timeout: 5000 })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Keine Zeitzone würde sich ändern/)).not.toBeInTheDocument();
  });
});
