import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { get, put, post } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock("../../../lib/api/client", () => ({ api: { get, put, post } }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

import WebdavSyncRow from "../WebdavSyncRow";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

/**
 * The account's WebDAV sync row (forgejo#321): an expert row, a form that
 * never shows the stored password, and every failure — the save's, the
 * run's, the last nightly one's — said with its own reason.
 */
const STATUS = {
  enabled: true,
  url: "https://cloud.example.com/dav",
  username: "me",
  hasPassword: true,
  remotePath: "/TravStats/",
  schedule: "daily",
  keepVersions: 5,
  ranAt: "2026-10-22T05:15:00.000Z",
  completedAt: null,
  lastStatus: "failed",
  lastErrorCode: "quota",
  lastFileName: null,
  lastSizeBytes: null,
  running: false,
  allowPrivateTargets: false,
};

function respond(status: Record<string, unknown> = STATUS): void {
  get.mockImplementation((url: string) => {
    if (url === "/settings/webdav-sync") return Promise.resolve({ data: status });
    if (url.startsWith("/jobs/")) {
      return Promise.resolve({
        data: {
          success: true,
          data: { id: "j", status: "failed", error: { code: "auth", status: 502 }, result: null },
        },
      });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

describe("WebdavSyncRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsLevelStore.setState({ level: "expert" });
    respond();
  });

  it("is not drawn at the standard level", () => {
    useSettingsLevelStore.setState({ level: "standard" });
    render(<WebdavSyncRow />);
    expect(screen.queryByTestId("webdav-sync-row")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("shows the last nightly failure with its reason, not just 'failed'", async () => {
    render(<WebdavSyncRow />);
    expect(await screen.findByText(/settings:webdavSync.last.failed/)).toHaveTextContent(
      "settings:webdavSync.errors.quota"
    );
  });

  it("says a bounded clean-up as itself, not as the generic failure", async () => {
    respond({
      ...STATUS,
      lastStatus: "partial",
      lastErrorCode: "cleanupIncomplete",
      completedAt: STATUS.ranAt,
      lastFileName: "travstats-export-0123456789ab-20261022T051500Z.json.gz",
      lastSizeBytes: 2048,
    });
    render(<WebdavSyncRow />);
    expect(await screen.findByText(/settings:webdavSync.last.partial/)).toHaveTextContent(
      "settings:webdavSync.errors.cleanupIncomplete"
    );
  });

  it("says a run that hit its deadline timed out", async () => {
    respond({ ...STATUS, lastErrorCode: "timeout" });
    render(<WebdavSyncRow />);
    expect(await screen.findByText(/settings:webdavSync.last.failed/)).toHaveTextContent(
      "settings:webdavSync.errors.timeout"
    );
  });

  it("never puts the stored password into the form", async () => {
    render(<WebdavSyncRow />);
    await userEvent.click(await screen.findByRole("button", { name: "settings:webdavSync.setup" }));
    expect(screen.getByLabelText("settings:webdavSync.password")).toHaveValue("");
    expect(screen.getByText("settings:webdavSync.passwordStored")).toBeInTheDocument();
  });

  it("says why a save was refused — a LAN share for an ordinary account", async () => {
    put.mockRejectedValue({ response: { status: 400, data: { error: "blockedTarget" } } });
    render(<WebdavSyncRow />);
    await userEvent.click(await screen.findByRole("button", { name: "settings:webdavSync.setup" }));
    const url = screen.getByLabelText("settings:webdavSync.url");
    await userEvent.clear(url);
    await userEvent.type(url, "http://192.168.1.5/dav");
    await userEvent.click(screen.getByRole("button", { name: "settings:webdavSync.save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "settings:webdavSync.errors.blockedTarget"
    );
    // An untouched password field sends no password: the stored one stays.
    expect(put.mock.calls[0][1]).not.toHaveProperty("password");
  });

  it("reports a failed run with the share's reason and reloads the recorded result", async () => {
    post.mockResolvedValue({ data: { jobId: "j" } });
    render(<WebdavSyncRow />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settings:webdavSync.runNow" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("settings:webdavSync.errors.auth");
    await waitFor(() =>
      expect(get.mock.calls.filter(([u]) => u === "/settings/webdav-sync").length).toBe(2)
    );
  });

  it("opens the form when switching on is refused for missing settings", async () => {
    respond({
      ...STATUS,
      enabled: false,
      url: null,
      hasPassword: false,
      lastStatus: null,
      ranAt: null,
    });
    put.mockRejectedValue({ response: { status: 400, data: { error: "notConfigured" } } });
    render(<WebdavSyncRow />);
    await userEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "settings:webdavSync.errors.notConfigured"
    );
    expect(screen.getByLabelText("settings:webdavSync.url")).toBeInTheDocument();
  });

  it("does not draw a form it could not fill: a load failure is said, nothing is saveable", async () => {
    get.mockRejectedValue(new Error("500"));
    render(<WebdavSyncRow />);
    expect(await screen.findByRole("alert")).toHaveTextContent("settings:webdavSync.loadError");
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
