import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * The spreadsheet import as a server job (silent-failure fixes, 2026-09-26).
 *
 * A large sheet costs a currency lookup per priced row and a `replace` a full
 * backup first. Posted as one request against the ten-second client timeout,
 * the page read "Die Datei konnte nicht gelesen werden" while the server went
 * on writing the rows. The request now answers with a job and the page reads
 * the job's outcome — these pin what the user sees for each one. Only the
 * workbook reader is stubbed; `sendImport` and the job poll are the real ones.
 */

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => true }),
}));
vi.mock("../../../lib/xlsx/importClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/xlsx/importClient")>();
  return {
    ...actual,
    readWorkbookForImport: vi.fn().mockResolvedValue([{ key: "flights", rows: [{}] }]),
  };
});

import { api } from "../../../lib/api/client";
import SpreadsheetSection from "../SpreadsheetSection";

const OUTCOME = {
  dryRun: true,
  mode: "merge",
  clean: true,
  backupId: null,
  sheets: [
    {
      key: "flights",
      created: 0,
      updated: 1,
      skipped: 0,
      errors: 0,
      deleted: 0,
      rows: [{ row: 2, action: "update", id: "f-1", label: "LH 1860" }],
    },
  ],
};

type JobState = { status: string; result?: unknown; error?: { code: string; status: number } };

function jobAnswers(states: JobState[]) {
  const queue = [...states];
  vi.spyOn(api, "get").mockImplementation(((url: string) => {
    if (!url.startsWith("/jobs/")) return Promise.resolve({ data: {} });
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    return Promise.resolve({
      data: {
        success: true,
        data: { id: "job-1", kind: "xlsx.import", result: null, error: null, ...next },
      },
    });
  }) as never);
}

async function choose(): Promise<void> {
  render(<SpreadsheetSection />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "export.xlsx")] } });
}

describe("SpreadsheetSection — the import is a job", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a preview that outlives the old timeout is shown, not reported as a broken file", async () => {
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValue({ data: { success: true, data: { jobId: "job-1" } } } as never);
    jobAnswers([{ status: "running" }, { status: "succeeded", result: OUTCOME }]);

    await choose();

    await waitFor(() => expect(screen.getByText("xlsx:import.preview")).toBeTruthy(), {
      timeout: 4000,
    });
    expect(screen.queryByText("xlsx:import.failed")).toBeNull();
    expect(post).toHaveBeenCalledWith(
      "/xlsx-import",
      expect.objectContaining({ dryRun: true, background: true })
    );
  });

  it("a refused safety backup reads as that, not as an unreadable file", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: { success: true, data: { jobId: "job-1" } },
    } as never);
    jobAnswers([
      { status: "succeeded", result: OUTCOME },
      { status: "failed", error: { code: "backup_failed", status: 503 } },
    ]);

    await choose();
    fireEvent.click(await screen.findByText("xlsx:import.apply"));

    await waitFor(() => expect(screen.getByText("xlsx:import.backupFailed")).toBeTruthy());
  });

  it("an outcome the server no longer reports is said to be unknown, never 'failed'", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: { success: true, data: { jobId: "job-1" } },
    } as never);
    let polls = 0;
    vi.spyOn(api, "get").mockImplementation((() => {
      polls += 1;
      // The preview's job answers; the apply's job is gone (a restart).
      if (polls === 1) {
        return Promise.resolve({
          data: { success: true, data: { id: "job-1", status: "succeeded", result: OUTCOME } },
        });
      }
      return Promise.reject({ isAxiosError: true, response: { status: 404 } });
    }) as never);

    await choose();
    fireEvent.click(await screen.findByText("xlsx:import.apply"));

    await waitFor(() => expect(screen.getByText("xlsx:import.outcomeUnknown")).toBeTruthy());
    expect(screen.queryByText("xlsx:import.failed")).toBeNull();
  });
});
