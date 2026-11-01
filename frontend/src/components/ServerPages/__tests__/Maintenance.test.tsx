import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetWriteQueue } from "../../ui/settings/writeQueue";
import MaintenanceLogging from "../MaintenanceLogging";
import MaintenanceSystem from "../MaintenanceSystem";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { httpError } from "./fixtures";

const admin = vi.hoisted(() => ({
  getLoggingConfig: vi.fn(),
  getLogFiles: vi.fn(),
  updateLoggingConfig: vi.fn(),
  toggleDebugLogging: vi.fn(),
  cleanupLogs: vi.fn(),
  deleteLogFile: vi.fn(),
  downloadLogFile: vi.fn(),
  getSystemInfo: vi.fn(),
  getUsers: vi.fn(),
  exportAllData: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({ adminApi: admin }));
const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../../lib/api/client", () => ({ api: client }));
vi.mock("../../Admin/LogViewer", () => ({ default: () => null }));

const config = (over = {}) => ({
  logLevel: "info",
  effectiveLogLevel: "info",
  logLevelSource: "settings",
  maxLogFileSize: 1,
  maxLogFiles: 1,
  logHttpRequests: false,
  logDatabaseQueries: false,
  logParserOperations: false,
  logRetentionDays: 7,
  ...over,
});
const oldFile = {
  filename: "app.2026-10-01.log",
  category: "app",
  size: 1000,
  created: "2026-10-01T00:00:00Z",
  modified: "2026-10-01T00:00:00Z",
  compressed: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsLevelStore.setState({ level: "expert" });
  admin.getLoggingConfig.mockResolvedValue(config());
  admin.getLogFiles.mockResolvedValue({ files: [oldFile] });
  admin.getSystemInfo.mockResolvedValue({ version: "2.8.0", buildVersion: "2.8.0-rc.9" });
  admin.getUsers.mockResolvedValue({ users: [] });
});
afterEach(() => {
  cleanup();
  resetWriteQueue();
  useSettingsLevelStore.setState({ level: null });
});

describe("Wartung › Protokoll", () => {
  it("says the level is pinned by the environment and locks the rows that cannot act on it", async () => {
    admin.getLoggingConfig.mockResolvedValue(
      config({ logLevelSource: "environment", effectiveLogLevel: "warn" })
    );
    render(<MaintenanceLogging />);
    expect(await screen.findAllByText("settingsRows:maintenance.deps.envPinned")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "settingsRows:maintenance.debug.t" })).toBeDisabled();
  });

  it("keeps the verbose switch where the user put it when the server refuses it", async () => {
    admin.toggleDebugLogging.mockRejectedValue(httpError(500));
    render(<MaintenanceLogging />);
    const verbose = await screen.findByRole("switch", { name: "settingsRows:maintenance.debug.t" });
    await userEvent.click(verbose);
    expect(verbose).toHaveAttribute("aria-checked", "true");
    await waitFor(
      () => expect(screen.getByText(/settings:blocks.save.failed/)).toBeInTheDocument(),
      {
        timeout: 3000,
      }
    );
    expect(verbose).toHaveAttribute("aria-checked", "true");
  });

  it("sends only what was edited, so a verbose switch flipped meanwhile is not written back", async () => {
    admin.toggleDebugLogging.mockResolvedValue({
      message: "ok",
      config: config({ logLevel: "debug" }),
    });
    admin.updateLoggingConfig.mockResolvedValue({
      message: "ok",
      config: config({ logLevel: "debug", logRetentionDays: 14 }),
    });
    render(<MaintenanceLogging />);
    const days = await screen.findByLabelText("settingsRows:maintenance.logtage.t");
    await userEvent.clear(days);
    await userEvent.type(days, "14");
    // The server now runs at debug (the switch), while the group still holds the old level "info".
    admin.getLoggingConfig.mockResolvedValue(config({ logLevel: "debug" }));
    await userEvent.click(screen.getByRole("switch", { name: "settingsRows:maintenance.debug.t" }));
    await waitFor(() => expect(admin.toggleDebugLogging).toHaveBeenCalledWith(true), {
      timeout: 3000,
    });
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" }));
    await waitFor(() =>
      expect(admin.updateLoggingConfig).toHaveBeenCalledWith({ logRetentionDays: 14 })
    );
  });

  it("deletes old logs only after the confirmation, and a refusal is named", async () => {
    admin.cleanupLogs.mockRejectedValue(httpError(500));
    render(<MaintenanceLogging />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settingsRows:maintenance.logclean.t" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(admin.cleanupLogs).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "settingsRows:dialogs.logclean.confirm" })
    );
    expect(await screen.findByText("admin:toasts.cleanupFailed")).toBeInTheDocument();
  });

  it("offers a retry when the log cannot be loaded", async () => {
    admin.getLoggingConfig.mockRejectedValueOnce(httpError());
    render(<MaintenanceLogging />);
    expect(await screen.findByText("settingsRows:maintenance.logLoadFailed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:server.retry" }));
    expect(
      await screen.findByRole("switch", { name: "settingsRows:maintenance.debug.t" })
    ).toBeInTheDocument();
  });

  it("names a refused log download and a refused single delete", async () => {
    admin.downloadLogFile.mockRejectedValue(httpError(404, { code: "LOG_FILE_NOT_FOUND" }));
    admin.deleteLogFile.mockRejectedValue(httpError(500));
    render(<MaintenanceLogging />);
    await userEvent.click(
      await screen.findByRole("button", { name: "admin:logging.files.download" })
    );
    expect(await screen.findByText("admin:logging.errors.LOG_FILE_NOT_FOUND")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "admin:logging.files.delete" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "settingsRows:dialogs.logdel.confirm",
      })
    );
    expect(await screen.findByText("admin:toasts.logFileDeletFailed")).toBeInTheDocument();
  });
});

describe("Wartung › System", () => {
  it("names a refused export instead of downloading an empty file", async () => {
    admin.exportAllData.mockRejectedValue(httpError(500));
    render(<MaintenanceSystem />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settingsRows:maintenance.download" })
    );
    expect(await screen.findByText("settingsRows:maintenance.errors.export")).toBeInTheDocument();
  });

  it("re-reads the catalogues only after the confirmation, and says when the hourly limit is reached", async () => {
    client.post.mockRejectedValue(
      Object.assign(new Error("429"), { isAxiosError: true, response: { status: 429 } })
    );
    render(<MaintenanceSystem />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settingsRows:maintenance.reseed.action" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(client.post).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "settingsRows:dialogs.reseed.confirm" })
    );
    await waitFor(() => expect(client.post).toHaveBeenCalledWith("/admin/airports/reseed"));
    // Each of the three catalogues ends in its own state; none stays "running".
    await waitFor(() => expect(screen.getAllByText("settings:blocks.job.failed")).toHaveLength(3));
  });

  it("repeats only the catalogue whose outcome is unknown, not all three", async () => {
    const timeout = Object.assign(new Error("timeout"), {
      isAxiosError: true,
      code: "ECONNABORTED",
    });
    client.post.mockImplementation(async (url: string) => {
      if (url === "/admin/airlines/reseed") throw timeout;
      return { data: { inserted: 5 } };
    });
    client.get.mockResolvedValue({ data: { status: "completed", totalAirports: 10 } });
    render(<MaintenanceSystem />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settingsRows:maintenance.reseed.action" })
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "settingsRows:dialogs.reseed.confirm",
      })
    );
    await userEvent.click(await screen.findByRole("button", { name: "settings:blocks.job.check" }));
    const urls = client.post.mock.calls.map((c) => c[0]);
    expect(urls.filter((u) => u === "/admin/airports/reseed")).toHaveLength(1);
    expect(urls.filter((u) => u === "/admin/airlines/reseed")).toHaveLength(2);
    expect(urls.filter((u) => u === "/admin/aircraft/reseed")).toHaveLength(1);
  });

  it("shows the demo account's removal only while a demo account exists, behind the confirmation", async () => {
    admin.getUsers.mockResolvedValue({
      users: [{ id: "d1", username: "demo", _count: { flights: 30, userAchievements: 0 } }],
    });
    admin.deleteUser.mockRejectedValue(httpError(500));
    render(<MaintenanceSystem />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settingsRows:maintenance.demodel.t" })
    );
    expect(admin.deleteUser).not.toHaveBeenCalled();
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "settingsRows:dialogs.demodel.confirm",
      })
    );
    expect(await screen.findByText("settingsRows:maintenance.errors.demo")).toBeInTheDocument();
  });

  it("offers a retry when the system data cannot be loaded", async () => {
    admin.getSystemInfo.mockRejectedValueOnce(httpError());
    render(<MaintenanceSystem />);
    expect(
      await screen.findByText("settingsRows:maintenance.systemLoadFailed")
    ).toBeInTheDocument();
  });
});
