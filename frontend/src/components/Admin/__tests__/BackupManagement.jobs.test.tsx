import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import adminDe from "../../../i18n/resources/de/admin.json";

/**
 * Backup and restore as jobs (silent-failure fixes, 2026-09-26).
 *
 * Both used to be one request held open for minutes against a ten-second
 * client timeout: the admin read "Fehler beim Wiederherstellen" over a
 * restore that completed, clicked again, and met a 409. The page now starts a
 * job and reads its outcome — these pin what the admin SEES for each outcome.
 */

function resolve(bundle: unknown, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, bundle);
}

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const raw = resolve(adminDe, key.replace(/^admin:/, "").replace(/^common:/, ""));
      return typeof raw === "string" ? raw : key;
    },
  }),
}));

const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (state: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

import { api } from "../../../lib/api/client";
import BackupManagement from "../BackupManagement";

const BACKUP = {
  id: "backup-1",
  type: "full",
  status: "completed",
  backupPath: "/data/backups/backup-1/backup-1.tar.gz",
  size: "1048576",
  retentionDays: 30,
  startedAt: "2026-09-12T02:00:00.000Z",
  completedAt: "2026-09-12T02:04:00.000Z",
  errorMessage: null,
  metadata: null,
  syncedToCloud: false,
  cloudSyncAt: null,
  cloudSyncError: null,
  createdAt: "2026-09-12T02:00:00.000Z",
  fileExists: true,
};

type JobAnswer = { status: string; result?: unknown; error?: { code: string; status: number } };

/** The page's reads, with `/jobs/:id` answering the given states in order. */
function mockGets(jobStates: JobAnswer[]) {
  const states = [...jobStates];
  return vi.spyOn(api, "get").mockImplementation(((url: string) => {
    if (url === "/backup") return Promise.resolve({ data: { backups: [BACKUP] } });
    if (url === "/backup/status")
      return Promise.resolve({ data: { running: false, currentBackup: null } });
    if (url === "/admin/webdav-settings")
      return Promise.resolve({ data: { settings: { enabled: false } } });
    if (url.startsWith("/jobs/")) {
      const next = states.length > 1 ? states.shift()! : states[0];
      return Promise.resolve({
        data: {
          success: true,
          data: {
            id: "job-1",
            kind: "backup.restore",
            startedAt: "2026-09-26T08:00:00.000Z",
            finishedAt: next.status === "running" ? null : "2026-09-26T08:03:00.000Z",
            result: next.result ?? null,
            error: next.error ?? null,
            status: next.status,
          },
        },
      });
    }
    return Promise.resolve({
      data: { backupEnabled: false, backupInterval: "weekly", backupRetentionDays: 30 },
    });
  }) as never);
}

async function confirmRestore(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Wiederherstellen" }));
  const field = await screen.findByPlaceholderText("Wiederherstellen");
  fireEvent.change(field, { target: { value: "Wiederherstellen" } });
  const dialog = screen.getByRole("dialog");
  const confirm = [...dialog.querySelectorAll("button")].find(
    (b) => b.textContent === "Wiederherstellen"
  )!;
  fireEvent.click(confirm);
}

describe("backup and restore report the job's real outcome", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    addToast.mockClear();
  });

  it("a restore that runs past the old timeout and then succeeds says so — never 'failed'", async () => {
    mockGets([{ status: "running" }, { status: "succeeded", result: { backupId: "backup-1" } }]);
    vi.spyOn(api, "post").mockResolvedValue({
      data: { success: true, data: { jobId: "job-1" } },
    } as never);

    render(<BackupManagement />);
    await confirmRestore();

    // While the job runs the dialog stays open and says what it is doing.
    expect(await screen.findByText("Wird wiederhergestellt …")).toBeTruthy();
    await waitFor(
      () => expect(addToast).toHaveBeenCalledWith("success", "Backup wiederhergestellt"),
      { timeout: 4000 }
    );
    expect(addToast).not.toHaveBeenCalledWith("error", expect.anything());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a restore the preflight refuses over the key keeps the dialog open and asks for it", async () => {
    mockGets([
      { status: "failed", error: { code: "RESTORE_ENCRYPTION_KEY_MISMATCH", status: 409 } },
    ]);
    vi.spyOn(api, "post").mockResolvedValue({
      data: { success: true, data: { jobId: "job-1" } },
    } as never);

    render(<BackupManagement />);
    await confirmRestore();

    expect(await screen.findByText(adminDe.backup.restore.keyMismatchTitle)).toBeTruthy();
    expect(addToast).not.toHaveBeenCalledWith("error", expect.anything());
  });

  it("a job the server forgot is reported as an unknown outcome, not as a failure", async () => {
    vi.spyOn(api, "get").mockImplementation(((url: string) => {
      if (url.startsWith("/jobs/"))
        return Promise.reject({ isAxiosError: true, response: { status: 404 } });
      if (url === "/backup") return Promise.resolve({ data: { backups: [BACKUP] } });
      if (url === "/backup/status")
        return Promise.resolve({ data: { running: false, currentBackup: null } });
      return Promise.resolve({ data: { settings: { enabled: false } } });
    }) as never);
    vi.spyOn(api, "post").mockResolvedValue({
      data: { success: true, data: { jobId: "job-1", backupId: "backup-2" } },
    } as never);

    render(<BackupManagement />);
    fireEvent.click(await screen.findByRole("button", { name: adminDe.backup.createNow }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", adminDe.backup.toasts.outcomeUnknown)
    );
  });

  it("a created backup is announced once it exists, not when it was merely started", async () => {
    mockGets([{ status: "succeeded", result: { backupId: "backup-2" } }]);
    vi.spyOn(api, "post").mockResolvedValue({
      data: { success: true, data: { jobId: "job-1", backupId: "backup-2" } },
    } as never);

    render(<BackupManagement />);
    fireEvent.click(await screen.findByRole("button", { name: adminDe.backup.createNow }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("success", adminDe.backup.toasts.created)
    );
  });
  // Acceptance 2026-09-26: the job failed with "spawn pg_dump ENOENT" in the
  // server log, and the page said only "Fehler beim Erstellen des Backups".
  it("a backup that fails for a missing pg_dump says what is missing", async () => {
    mockGets([{ status: "failed", error: { code: "BACKUP_TOOL_MISSING", status: 500 } }]);
    vi.spyOn(api, "post").mockResolvedValue({
      data: { success: true, data: { jobId: "job-1", backupId: "backup-2" } },
    } as never);

    render(<BackupManagement />);
    fireEvent.click(await screen.findByRole("button", { name: adminDe.backup.createNow }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", adminDe.backup.failure.BACKUP_TOOL_MISSING)
    );
    expect(addToast).not.toHaveBeenCalledWith("error", adminDe.backup.toasts.createFailed);
  });

  it("a restore that runs out of disk says the drive is full", async () => {
    mockGets([{ status: "failed", error: { code: "BACKUP_DISK_FULL", status: 500 } }]);
    vi.spyOn(api, "post").mockResolvedValue({
      data: { success: true, data: { jobId: "job-1" } },
    } as never);

    render(<BackupManagement />);
    await confirmRestore();

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", adminDe.backup.failure.BACKUP_DISK_FULL)
    );
  });
});
