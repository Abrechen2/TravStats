import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShareLinksSettings from "../ShareLinksSettings";
import { adminApi } from "../../../lib/api";
import { logger } from "../../../lib/logger";

vi.mock("../../../lib/api", () => ({
  adminApi: { getInstanceSettings: vi.fn(), updateInstanceSettings: vi.fn() },
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const api = vi.mocked(adminApi);
const response = (enabled: boolean, stats = { links: 9, accounts: 3 }) =>
  ({ settings: { shareLinksEnabled: enabled }, shareLinkStats: stats }) as Awaited<
    ReturnType<typeof adminApi.getInstanceSettings>
  >;

const confirmOff = async (): Promise<void> => {
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "settingsRows:dialogs.linksoff.confirm" })
  );
};

describe("public links in instance administration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getInstanceSettings.mockResolvedValue(response(true));
  });

  it("switching OFF deletes every link, so it asks first and writes nothing before the answer", async () => {
    api.updateInstanceSettings.mockResolvedValue(response(false));
    render(<ShareLinksSettings />);
    const toggle = await screen.findByRole("switch");
    await userEvent.click(toggle);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("settingsRows:dialogs.linksoff.title");
    expect(api.updateInstanceSettings).not.toHaveBeenCalled();
    // The focus starts on the harmless button, as the block promises.
    expect(
      within(dialog).getByRole("button", { name: "settings:blocks.confirm.cancel" })
    ).toHaveFocus();
    await confirmOff();
    expect(api.updateInstanceSettings).toHaveBeenCalledWith({ shareLinksEnabled: false });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });

  it("cancelling the question leaves the links and the switch alone", async () => {
    render(<ShareLinksSettings />);
    await userEvent.click(await screen.findByRole("switch"));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "settings:blocks.confirm.cancel",
      })
    );
    expect(api.updateInstanceSettings).not.toHaveBeenCalled();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("switching ON needs no question and writes at once", async () => {
    api.getInstanceSettings.mockResolvedValue(response(false, { links: 0, accounts: 0 }));
    api.updateInstanceSettings.mockResolvedValue(response(true));
    render(<ShareLinksSettings />);
    await userEvent.click(await screen.findByRole("switch"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.updateInstanceSettings).toHaveBeenCalledWith({ shareLinksEnabled: true });
  });

  it("keeps the last confirmed value and reports a failed write", async () => {
    api.updateInstanceSettings.mockRejectedValue(new Error("offline"));
    render(<ShareLinksSettings />);
    const toggle = await screen.findByRole("switch");
    await userEvent.click(toggle);
    await confirmOff();
    expect(await screen.findByRole("alert")).toHaveTextContent("sharing:links.section.saveFailed");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
  });

  it("does not offer a write when loading fails, and logs why", async () => {
    const loadError = new Error("load offline");
    api.getInstanceSettings.mockRejectedValue(loadError);
    render(<ShareLinksSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("sharing:links.section.loadFailed");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), loadError);
  });
});
