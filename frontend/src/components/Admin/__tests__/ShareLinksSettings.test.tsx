import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShareLinksSettings from "../ShareLinksSettings";
import { adminApi } from "../../../lib/api";
import { logger } from "../../../lib/logger";

vi.mock("../../../lib/api", () => ({
  adminApi: { getInstanceSettings: vi.fn(), updateInstanceSettings: vi.fn() },
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const api = vi.mocked(adminApi);
const response = (enabled: boolean) =>
  ({ settings: { shareLinksEnabled: enabled } }) as Awaited<
    ReturnType<typeof adminApi.getInstanceSettings>
  >;

describe("public links in instance administration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getInstanceSettings.mockResolvedValue(response(true));
  });
  it("saves only the instance switch and displays the confirmed value", async () => {
    api.updateInstanceSettings.mockResolvedValue(response(false));
    render(<ShareLinksSettings />);
    const toggle = await screen.findByRole("switch");
    await userEvent.click(toggle);
    expect(api.updateInstanceSettings).toHaveBeenCalledWith({ shareLinksEnabled: false });
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
  });
  it("keeps the last confirmed value and reports a failed write", async () => {
    api.updateInstanceSettings.mockRejectedValue(new Error("offline"));
    render(<ShareLinksSettings />);
    const toggle = await screen.findByRole("switch");
    await userEvent.click(toggle);
    expect(await screen.findByRole("alert")).toHaveTextContent("sharing:links.section.saveFailed");
    expect((toggle as HTMLInputElement).checked).toBe(true);
  });
  it("does not offer a write when loading fails", async () => {
    api.getInstanceSettings.mockRejectedValue(new Error("offline"));
    render(<ShareLinksSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("sharing:links.section.loadFailed");
    expect(screen.queryByRole("switch")).toBeNull();
  });
  // Both failures were swallowed: the page said "failed" and nothing anywhere
  // said why, so a 403 and an outage were indistinguishable afterwards.
  it("logs why the load and the write failed", async () => {
    const loadError = new Error("load offline");
    api.getInstanceSettings.mockRejectedValueOnce(loadError);
    const { unmount } = render(<ShareLinksSettings />);
    await screen.findByRole("alert");
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), loadError);
    unmount();

    const writeError = new Error("write offline");
    api.updateInstanceSettings.mockRejectedValue(writeError);
    render(<ShareLinksSettings />);
    await userEvent.click(await screen.findByRole("switch"));
    await screen.findByText("sharing:links.section.saveFailed");
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), writeError);
  });
});
