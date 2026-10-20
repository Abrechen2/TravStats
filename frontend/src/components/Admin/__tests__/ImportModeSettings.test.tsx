import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportModeSettings from "../ImportModeSettings";
import { adminApi } from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  adminApi: { getImportMode: vi.fn(), setImportMode: vi.fn(), getUsers: vi.fn() },
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const api = vi.mocked(adminApi);
const users = {
  users: [
    { id: "u-1", username: "anna", isActive: true },
    { id: "u-2", username: "ben", isActive: true },
    { id: "u-3", username: "gone", isActive: false },
  ],
} as unknown as Awaited<ReturnType<typeof adminApi.getUsers>>;
const OFF = { until: null, userId: null, hours: 24 };

/** forgejo#304: the card switches import mode on for one account or all, and off again. */
describe("import mode in instance administration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getUsers.mockResolvedValue(users);
    api.getImportMode.mockResolvedValue(OFF);
  });

  it("switches it on for the chosen account and shows until when", async () => {
    api.setImportMode.mockResolvedValue({
      until: "2026-10-21T10:00:00Z",
      userId: "u-2",
      hours: 24,
    });
    render(<ImportModeSettings />);
    const select = await screen.findByLabelText("admin:importMode.account");
    // An inactive account cannot import anything; it is not offered.
    expect(screen.queryByRole("option", { name: "gone" })).toBeNull();
    await userEvent.selectOptions(select, "u-2");
    await userEvent.click(screen.getByRole("button", { name: "admin:importMode.start" }));
    expect(api.setImportMode).toHaveBeenCalledWith({ enabled: true, userId: "u-2" });
    expect(await screen.findByText("admin:importMode.activeFor")).toBeInTheDocument();
  });

  it("switches it on for every account when none is chosen, and ends it early", async () => {
    api.setImportMode
      .mockResolvedValueOnce({ until: "2026-10-21T10:00:00Z", userId: null, hours: 24 })
      .mockResolvedValueOnce(OFF);
    render(<ImportModeSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "admin:importMode.start" }));
    expect(api.setImportMode).toHaveBeenCalledWith({ enabled: true, userId: null });
    await userEvent.click(await screen.findByRole("button", { name: "admin:importMode.stop" }));
    expect(api.setImportMode).toHaveBeenLastCalledWith({ enabled: false });
    expect(await screen.findByText("admin:importMode.off")).toBeInTheDocument();
  });

  it("says when saving failed and keeps the confirmed state", async () => {
    api.setImportMode.mockRejectedValue(new Error("offline"));
    render(<ImportModeSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "admin:importMode.start" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("admin:importMode.saveFailed");
    expect(screen.getByText("admin:importMode.off")).toBeInTheDocument();
  });

  it("offers no switch when loading fails", async () => {
    api.getImportMode.mockRejectedValue(new Error("offline"));
    render(<ImportModeSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("admin:importMode.loadFailed");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
