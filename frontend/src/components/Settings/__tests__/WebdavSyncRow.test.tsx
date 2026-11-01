import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render as plainRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

const { get, put, post } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock("../../../lib/api/client", () => ({ api: { get, put, post } }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
let demo = false;
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo }));

import WebdavSyncRow, { WebdavSyncPanel } from "../WebdavSyncRow";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { resetWriteQueue } from "../../ui/settings/writeQueue";

const render = (ui: ReactElement) => plainRender(<MemoryRouter>{ui}</MemoryRouter>);

/**
 * The account's own WebDAV copy on the rebuilt rows: four rows each writing at
 * once, a connection form that never shows the stored password, and every
 * failure — the write's, the run's, the last nightly one's — said with its own
 * reason, the share's never worded as ours.
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
const WAIT = { timeout: 3000 };
const renderRow = async (ui: ReactElement = <WebdavSyncRow />): Promise<void> => {
  await act(async () => {
    render(ui);
  });
};

describe("WebdavSyncRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    demo = false;
    useSettingsLevelStore.setState({ level: "expert" });
    respond();
  });
  afterEach(() => {
    cleanup();
    act(() => resetWriteQueue());
  });

  it("draws the expert row 'Versionen behalten' only at the expert level", async () => {
    useSettingsLevelStore.setState({ level: "standard" });
    await renderRow();
    expect(await screen.findByText("settingsRows:data.webdaveigen.t")).toBeInTheDocument();
    expect(screen.queryByText("settingsRows:data.webdavvers.t")).toBeNull();
  });

  it("shows the last nightly failure with its reason, not just 'failed'", async () => {
    await renderRow();
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
    await renderRow();
    expect(await screen.findByText(/settings:webdavSync.last.partial/)).toHaveTextContent(
      "settings:webdavSync.errors.cleanupIncomplete"
    );
  });

  it("never puts the stored password into the connection form", async () => {
    await renderRow(<WebdavSyncPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "settings:webdavSync.setup" }));
    expect(screen.getByLabelText("settings:webdavSync.password")).toHaveValue("");
    expect(screen.getByText("settings:webdavSync.passwordStored")).toBeInTheDocument();
  });

  it("says why a connection save was refused — a LAN share for an ordinary account", async () => {
    put.mockRejectedValue({ response: { status: 400, data: { error: "blockedTarget" } } });
    await renderRow(<WebdavSyncPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "settings:webdavSync.setup" }));
    const url = screen.getByLabelText("settings:webdavSync.url");
    await userEvent.clear(url);
    await userEvent.type(url, "http://192.168.1.5/dav");
    await userEvent.click(screen.getByRole("button", { name: "settings:webdavSync.save" }));
    expect(await screen.findByText("settings:webdavSync.errors.blockedTarget")).toBeInTheDocument();
    // An untouched password field sends no password: the stored one stays.
    expect(put.mock.calls[0][1]).not.toHaveProperty("password");
  });

  it.each([
    ["httpsRequired", 400],
    ["tls", 400],
    ["invalidUrl", 400],
    ["notConfigured", 400],
  ])("says the %s refusal of a save as its own sentence", async (code, status) => {
    put.mockRejectedValue({ response: { status, data: { error: code } } });
    await renderRow();
    await userEvent.click(
      await screen.findByRole("radio", { name: "settings:webdavSync.schedules.weekly" })
    );
    expect(
      await screen.findByText(`settings:webdavSync.errors.${code}`, undefined, WAIT)
    ).toBeInTheDocument();
  });

  it("a refused schedule change keeps the pick, says so and 'Erneut versuchen' sends it again", async () => {
    put.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue({
      data: { ...STATUS, schedule: "weekly" },
    });
    await renderRow();
    await userEvent.click(
      await screen.findByRole("radio", { name: "settings:webdavSync.schedules.weekly" })
    );
    expect(
      await screen.findByText(/settings:blocks.save.failed/, undefined, WAIT)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "settings:webdavSync.schedules.weekly" })
    ).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2), WAIT);
    expect(put.mock.calls[1][1]).toEqual({ schedule: "weekly" });
  });

  it("only 1-30 versions are sent; anything else is said under the field", async () => {
    put.mockResolvedValue({ data: { ...STATUS, keepVersions: 9 } });
    await renderRow();
    const field = await screen.findByLabelText("settingsRows:data.webdavvers.t");
    await userEvent.clear(field);
    await userEvent.type(field, "99");
    await userEvent.tab();
    expect(await screen.findByText("settings:webdavSync.versionsInvalid")).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    await userEvent.clear(field);
    await userEvent.type(field, "9");
    await userEvent.tab();
    await waitFor(
      () => expect(put).toHaveBeenCalledWith("/settings/webdav-sync", { keepVersions: 9 }),
      WAIT
    );
  });

  it("reports a failed run with the share's reason and reloads the recorded result", async () => {
    post.mockResolvedValue({ data: { jobId: "j" } });
    await renderRow();
    await userEvent.click(
      await screen.findByRole("button", { name: "settingsRows:data.webdavjetzt.btn" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("settings:webdavSync.errors.auth");
    await waitFor(() =>
      expect(get.mock.calls.filter(([u]) => u === "/settings/webdav-sync").length).toBe(2)
    );
  });

  it("says our own rate limit (429) as ours, not as the share's", async () => {
    post.mockRejectedValue({ response: { status: 429, data: { error: "Too many requests" } } });
    await renderRow();
    await userEvent.click(
      await screen.findByRole("button", { name: "settingsRows:data.webdavjetzt.btn" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "settings:webdavSync.errors.rateLimited"
    );
  });

  it("without a connection the toggle is locked, with the reason, and the jump leads to Services", async () => {
    respond({
      ...STATUS,
      enabled: false,
      url: null,
      hasPassword: false,
      lastStatus: null,
      ranAt: null,
    });
    await renderRow();
    expect(await screen.findByText("settings:blocks.dep.noWebdav.reason")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")[0]).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /settings:blocks.dep.noWebdav.jump/ })
    ).toBeInTheDocument();
  });

  it("with the copy off, schedule and upload are locked with 'Wirkt erst mit WebDAV-Kopie'", async () => {
    respond({ ...STATUS, enabled: false });
    await renderRow();
    expect(
      (await screen.findAllByText("settings:blocks.dep.webdavOff.reason")).length
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole("button", { name: "settingsRows:data.webdavjetzt.btn" })
    ).toBeDisabled();
  });

  it("does not draw rows it could not fill: a load failure is said, nothing is saveable", async () => {
    get.mockRejectedValue(new Error("500"));
    await renderRow();
    expect(await screen.findByRole("alert")).toHaveTextContent("settings:webdavSync.loadError");
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("locks every row in the demo account", async () => {
    demo = true;
    await renderRow();
    expect(
      await screen.findByRole("button", { name: "settingsRows:data.webdavjetzt.btn" })
    ).toBeDisabled();
    expect(screen.getAllByRole("switch")[0]).toBeDisabled();
  });
});
