import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import BackupsAutomatic from "../BackupsAutomatic";
import BackupsExisting from "../BackupsExisting";
import { restoreOutcome } from "../restoreFailure";
import { JobFailedError, JobLostError } from "../../../lib/api/jobs";
import { httpError } from "./fixtures";
import { useBackupScheduleStore } from "../../../store/backupScheduleStore";

const backup = vi.hoisted(() => ({
  getBackupSettings: vi.fn(),
  updateBackupSettings: vi.fn(),
  list: vi.fn(),
  getStatus: vi.fn(),
  create: vi.fn(),
  restore: vi.fn(),
  delete: vi.fn(),
  download: vi.fn(),
  syncToCloud: vi.fn(),
}));
const admin = vi.hoisted(() => ({ getWebDAVSettings: vi.fn() }));
vi.mock("../../../lib/api", () => ({ backupApi: backup, adminApi: admin }));
const jobs = vi.hoisted(() => ({ waitForJob: vi.fn() }));
vi.mock("../../../lib/api/jobs", async (original) => ({
  ...(await original<typeof import("../../../lib/api/jobs")>()),
  waitForJob: jobs.waitForJob,
}));
vi.mock("../../Admin/CloudBackupList", () => ({ default: () => <div data-testid="cloud-list" /> }));

const entry = (id: string, over = {}) => ({
  id,
  type: "full",
  status: "completed",
  backupPath: "/b",
  size: "1048576",
  retentionDays: 30,
  startedAt: "2026-11-01T01:00:00Z",
  completedAt: "2026-11-01T01:05:00Z",
  errorMessage: null,
  metadata: null,
  syncedToCloud: false,
  cloudSyncAt: null,
  cloudSyncError: null,
  createdAt: "2026-11-01T01:00:00Z",
  fileExists: true,
  ...over,
});

// "Sicherungen von WebDAV holen" can send you to the service, so the page needs a router.
const renderExisting = () =>
  render(
    <MemoryRouter>
      <BackupsExisting />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  useBackupScheduleStore.setState({ saved: null });
  backup.getBackupSettings.mockResolvedValue({
    backupInterval: "weekly",
    backupRetentionDays: 30,
    backupCloudRetention: false,
    backupZone: null,
    hostZone: "UTC",
  });
  backup.list.mockResolvedValue({ backups: [entry("b1")] });
  backup.getStatus.mockResolvedValue({ running: false, currentBackup: null });
  admin.getWebDAVSettings.mockResolvedValue({ settings: { enabled: false } });
});
afterEach(cleanup);

describe("Sicherungen › Automatisch", () => {
  it("draws no form from a failed load, because saving placeholders would switch backups off", async () => {
    backup.getBackupSettings.mockRejectedValueOnce(httpError());
    render(<BackupsAutomatic />);
    expect(await screen.findByText("settingsRows:backups.loadFailed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "settings:blocks.save.saveGroup" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:server.retry" }));
    expect(
      await screen.findByRole("button", { name: "settings:blocks.save.saveGroup" })
    ).toBeInTheDocument();
  });

  it("refuses a retention outside 1 to 365 days and keeps Speichern off", async () => {
    render(<BackupsAutomatic />);
    const days = await screen.findByLabelText("settingsRows:backups.bakhalten.t");
    await userEvent.clear(days);
    await userEvent.type(days, "400");
    expect(screen.getByText("settingsRows:backups.errors.range")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" })).toBeDisabled();
  });

  it("keeps the typed retention when the save is refused", async () => {
    backup.updateBackupSettings.mockRejectedValue(httpError(500));
    render(<BackupsAutomatic />);
    const days = await screen.findByLabelText("settingsRows:backups.bakhalten.t");
    await userEvent.clear(days);
    await userEvent.type(days, "14");
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" }));
    await waitFor(() =>
      expect(document.querySelector('[data-group-state="failed"]')).toBeInTheDocument()
    );
    expect(days).toHaveValue(14);
  });

  it("locks the WebDAV clean-up with its reason while the WebDAV copy is off", async () => {
    render(<BackupsAutomatic />);
    expect(await screen.findByText("settingsRows:backups.deps.webdavOff")).toBeInTheDocument();
  });
});

describe("Sicherungen › Vorhandene", () => {
  const openMenu = async (): Promise<void> => {
    await userEvent.click(await screen.findByRole("button", { name: "settingsRows:backups.menu" }));
  };

  it("runs a backup as a job and names the cause when it fails", async () => {
    backup.create.mockResolvedValue({ jobId: "j1" });
    jobs.waitForJob.mockRejectedValue(new JobFailedError("BACKUP_DISK_FULL", 500));
    renderExisting();
    await userEvent.click(await screen.findByRole("button", { name: "settingsRows:backups.now" }));
    // The job block words the cause (the suite's translator echoes keys, so the reason itself is not visible).
    expect(await screen.findByText("settings:blocks.job.failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:blocks.job.retry" })).toBeInTheDocument();
  });

  it("says it does not know when the server forgot the backup job", async () => {
    backup.create.mockResolvedValue({ jobId: "j1" });
    jobs.waitForJob.mockRejectedValue(new JobLostError());
    renderExisting();
    await userEvent.click(await screen.findByRole("button", { name: "settingsRows:backups.now" }));
    expect(await screen.findByText("settings:blocks.job.unknown")).toBeInTheDocument();
  });

  it("restores only behind the typed confirmation, and writes nothing before it", async () => {
    backup.restore.mockResolvedValue({ jobId: "j2" });
    jobs.waitForJob.mockResolvedValue(undefined);
    renderExisting();
    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "settingsRows:backups.restoreAction.database" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("settingsRows:backups.restoreScope.database");
    expect(backup.restore).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "settingsRows:dialogs.restore.confirm" })
    );
    await waitFor(() =>
      expect(backup.restore).toHaveBeenCalledWith("b1", {
        scope: "database",
        createBackupBefore: true,
        acceptEncryptionKeyChange: false,
      })
    );
  });

  it("turns the encryption-key refusal into a question and restores only after it is answered", async () => {
    backup.restore.mockResolvedValue({ jobId: "j2" });
    jobs.waitForJob
      .mockRejectedValueOnce(new JobFailedError("RESTORE_ENCRYPTION_KEY_MISMATCH", 409))
      .mockResolvedValueOnce(undefined);
    renderExisting();
    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "settingsRows:backups.restoreAction.full" })
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "settingsRows:dialogs.restore.confirm",
      })
    );
    const ask = await screen.findByText("settingsRows:dialogs.restorekey.title");
    expect(ask).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "settingsRows:dialogs.restorekey.confirm",
      })
    );
    await waitFor(() => expect(backup.restore).toHaveBeenCalledTimes(2));
    expect(backup.restore.mock.calls[1][1]).toMatchObject({ acceptEncryptionKeyChange: true });
  });

  it("names why a restore was refused and that nothing was written", async () => {
    backup.restore.mockResolvedValue({ jobId: "j2" });
    jobs.waitForJob.mockRejectedValue(new JobFailedError("RESTORE_ARCHIVE_NEWER", 409));
    renderExisting();
    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "settingsRows:backups.restoreAction.full" })
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "settingsRows:dialogs.restore.confirm",
      })
    );
    expect(
      await screen.findByText("settingsRows:backups.restoreFailure.newer")
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says the hourly limit is reached when the restore answers 429", () => {
    expect(restoreOutcome(httpError(429, { code: "RATE_LIMITED" }))).toBe("rateLimited");
    expect(restoreOutcome(httpError(409, {}))).toBe("busy");
    expect(restoreOutcome(new JobLostError())).toBe("unknown");
    expect(restoreOutcome(httpError(500, { error: "something English" }))).toBe("failed");
  });

  it("names a failed delete and keeps the backup in the list", async () => {
    backup.delete.mockRejectedValue(httpError(500));
    renderExisting();
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "common:buttons.delete" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "settingsRows:dialogs.bakdel.confirm",
      })
    );
    expect(await screen.findByText("settingsRows:backups.errors.delete")).toBeInTheDocument();
    expect(backup.list).toHaveBeenCalled();
  });

  it("names a failed download", async () => {
    backup.download.mockRejectedValue(httpError(500));
    renderExisting();
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "admin:backup.actions.download" }));
    expect(await screen.findByText("settingsRows:backups.errors.download")).toBeInTheDocument();
  });

  it("offers a retry when the list cannot be loaded", async () => {
    backup.list.mockRejectedValueOnce(httpError());
    renderExisting();
    expect(await screen.findByText("settingsRows:backups.errors.list")).toBeInTheDocument();
  });

  it("offers the upload only while the WebDAV copy is on", async () => {
    admin.getWebDAVSettings.mockResolvedValue({ settings: { enabled: true } });
    renderExisting();
    await openMenu();
    expect(
      await screen.findByRole("menuitem", { name: "admin:backup.actions.upload" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("cloud-list")).toBeInTheDocument();
  });

  it("says why upload and the cloud list are missing when the WebDAV status cannot be read, and retries", async () => {
    admin.getWebDAVSettings.mockRejectedValueOnce(httpError());
    admin.getWebDAVSettings.mockResolvedValue({ settings: { enabled: true } });
    renderExisting();
    expect(await screen.findByText(/backups\.errors\.webdavStatus/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:backups.retry" }));
    expect(await screen.findByTestId("cloud-list")).toBeInTheDocument();
    expect(screen.queryByText(/backups\.errors\.webdavStatus/)).toBeNull();
  });

  it("tells without a WebDAV target that fetching backups has nothing to fetch from, and goes to the service", async () => {
    admin.getWebDAVSettings.mockResolvedValue({ settings: { enabled: false } });
    renderExisting();
    expect(await screen.findByText("settings:blocks.dep.noWebdav.reason")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settings:blocks.dep.noWebdav.jump/ })).toBeEnabled();
    expect(screen.queryByTestId("cloud-list")).toBeNull();
  });

  it("opens with the schedule and what the list holds: the last completed backup, the rhythm, how many are kept", async () => {
    backup.list.mockResolvedValue({
      backups: [
        entry("old", { completedAt: "2026-10-25T01:05:00Z" }),
        entry("new", { completedAt: "2026-11-01T01:05:00Z", size: "1288490188" }),
        entry("broken", { status: "failed", completedAt: null }),
      ],
    });
    renderExisting();
    expect(await screen.findByText("settingsRows:backups.nowLine")).toBeInTheDocument();
    const stats = await waitFor(() => {
      const el = document.querySelector("[data-backup-stats]") as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    expect(stats).toHaveTextContent("1.2 GB");
    expect(stats).toHaveTextContent("settingsRows:backups.stats.keptCount");
    expect(stats).toHaveTextContent("settingsRows:backups.rhythm");
  });

  it("has no off state: an old server answer with backupEnabled false still shows the rhythm (S6)", async () => {
    backup.getBackupSettings.mockResolvedValue({
      backupEnabled: false,
      backupInterval: "weekly",
      backupRetentionDays: 30,
    } as never);
    renderExisting();
    await waitFor(() =>
      expect(screen.getAllByText("settingsRows:backups.nowLine").length).toBeGreaterThan(0)
    );
    expect(document.body.textContent).not.toMatch(/backups\.rhythmOff/);
  });

  it("refreshes the summary when the tuning group below it saves a new schedule", async () => {
    const saved = {
      backupInterval: "monthly",
      backupRetentionDays: 30,
      backupCloudRetention: false,
      backupZone: null,
      hostZone: "UTC",
    };
    backup.updateBackupSettings.mockResolvedValue(saved);
    render(
      <MemoryRouter>
        <BackupsExisting />
        <BackupsAutomatic />
      </MemoryRouter>
    );
    expect(await screen.findByText("settingsRows:backups.nowLine")).toBeInTheDocument();
    await userEvent.click(await screen.findByText("settings:backup.intervals.monthly"));
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" }));
    await waitFor(() =>
      expect(backup.updateBackupSettings).toHaveBeenCalledWith(
        expect.objectContaining({ backupInterval: "monthly" })
      )
    );
    // The summary reads the schedule from this store; the save must publish the new one.
    await waitFor(() => expect(useBackupScheduleStore.getState().saved).toEqual(saved));
  });
});
