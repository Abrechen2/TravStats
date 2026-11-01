import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getSettings, updateSettings, testConnection, sweepNow } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  testConnection: vi.fn(),
  sweepNow: vi.fn(),
}));
vi.mock("../../../lib/api/dawarich", () => ({
  dawarichAdminApi: { getSettings, updateSettings, testConnection, sweepNow },
  dawarichFailureKind: (e: unknown) =>
    (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null,
  dawarichFailureKey: (k: unknown) => `fail.${String(k)}`,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key}:${JSON.stringify(o)}` : key),
  }),
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

import { JobLostError } from "../../../lib/api/jobs";
import DawarichGlobalSettings from "../DawarichGlobalSettings";

describe("DawarichGlobalSettings (forgejo#397)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({ baseUrl: "https://d.example", apiKey: "abcd****wxyz" });
  });

  it("never offers the editable form when the load failed, so a save cannot wipe the connection", async () => {
    getSettings.mockRejectedValue(new Error("500"));
    render(<DawarichGlobalSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("dawarichGlobal.loadFailed");
    expect(screen.queryByRole("button", { name: "admin:dawarichGlobal.save" })).toBeNull();
  });

  it("echoes the masked key back and toasts the save", async () => {
    updateSettings.mockResolvedValue({ baseUrl: "https://d.example", apiKey: "abcd****wxyz" });
    render(<DawarichGlobalSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "admin:dawarichGlobal.save" }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        baseUrl: "https://d.example",
        apiKey: "abcd****wxyz",
      })
    );
    expect(addToast).toHaveBeenCalledWith("success", "admin:dawarichGlobal.saved");
  });

  it("toasts a failed save", async () => {
    updateSettings.mockRejectedValue(new Error("x"));
    render(<DawarichGlobalSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "admin:dawarichGlobal.save" }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "admin:dawarichGlobal.saveFailed")
    );
  });

  it("names the connection failure kind from the test", async () => {
    testConnection.mockRejectedValue({ response: { data: { error: "auth" } } });
    render(<DawarichGlobalSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "admin:dawarichGlobal.test" }));
    expect(await screen.findByRole("status")).toHaveTextContent("fail.auth");
  });

  it("reports the sweep's outcome, including accounts that failed", async () => {
    sweepNow.mockResolvedValue({
      users: 3,
      failed: 1,
      degraded: 0,
      monthsSwept: 4,
      daysWritten: 9,
      partialDays: 0,
    });
    render(<DawarichGlobalSettings />);
    await userEvent.click(
      await screen.findByRole("button", { name: "admin:dawarichGlobal.sweep.action" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("sweep.doneWithFailures");
  });

  it("says the sweep outcome is unknown when the job was lost, and names a 409 already-running", async () => {
    sweepNow.mockRejectedValueOnce(new JobLostError());
    render(<DawarichGlobalSettings />);
    const run = async () =>
      userEvent.click(
        await screen.findByRole("button", { name: "admin:dawarichGlobal.sweep.action" })
      );
    await run();
    expect(await screen.findByRole("alert")).toHaveTextContent("sweep.lost");
    sweepNow.mockRejectedValueOnce({ response: { status: 409, data: { code: "SWEEP_RUNNING" } } });
    await run();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("sweep.running"));
  });

  it("does not call a sweep with only degraded accounts a success", async () => {
    sweepNow.mockResolvedValue({
      users: 2,
      failed: 0,
      degraded: 2,
      monthsSwept: 0,
      daysWritten: 0,
      partialDays: 0,
    });
    render(<DawarichGlobalSettings />);
    await userEvent.click(
      await screen.findByRole("button", { name: "admin:dawarichGlobal.sweep.action" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("sweep.doneWithFailures");
  });
});
