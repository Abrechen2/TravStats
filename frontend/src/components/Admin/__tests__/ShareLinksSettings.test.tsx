import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShareLinksSettings from "../ShareLinksSettings";
import { adminApi } from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  adminApi: { getInstanceSettings: vi.fn(), updateInstanceSettings: vi.fn() },
}));
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
});
