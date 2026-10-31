import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const getPreferences = vi.fn();
const updatePreferences = vi.fn();
vi.mock("../../../lib/api", () => ({
  notificationsApi: {
    getPreferences: () => getPreferences(),
    updatePreferences: (p: unknown) => updatePreferences(p),
  },
}));

const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (select: (s: { addToast: typeof addToast }) => unknown) => select({ addToast }),
}));

import NotificationPreferences from "../NotificationPreferences";

const STORED = { notificationEmail: "a@example.com", notifyBefore24h: false, notifyBefore2h: true };

describe("NotificationPreferences", () => {
  beforeEach(() => {
    getPreferences.mockReset().mockResolvedValue(STORED);
    updatePreferences.mockReset();
    addToast.mockReset();
  });

  it("has no save button: a switch writes the moment it changes", async () => {
    updatePreferences.mockResolvedValue({ ...STORED, notifyBefore24h: true });
    const user = userEvent.setup();
    render(<NotificationPreferences />);

    const toggle = await screen.findByRole("switch", { name: /before24h/ });
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    await user.click(toggle);

    expect(updatePreferences).toHaveBeenCalledWith({ notifyBefore24h: true });
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("puts the switch back when the write fails, so the screen never shows an unsaved state", async () => {
    updatePreferences.mockRejectedValue(new Error("nope"));
    const user = userEvent.setup();
    render(<NotificationPreferences />);

    const toggle = await screen.findByRole("switch", { name: /before2h/ });
    await user.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
    expect(addToast).toHaveBeenCalledWith("error", "nope");
  });

  it("writes the address when the field is left, and only if it changed", async () => {
    updatePreferences.mockResolvedValue({ ...STORED, notificationEmail: null });
    const user = userEvent.setup();
    render(<NotificationPreferences />);

    const field = await screen.findByLabelText("settings:notifications.email");
    await user.click(field);
    await user.tab();
    expect(updatePreferences).not.toHaveBeenCalled();

    await user.clear(field);
    await user.tab();
    expect(updatePreferences).toHaveBeenCalledWith({ notificationEmail: null });
  });

  it("persists two quick toggles both, in the order they were made", async () => {
    let releaseFirst!: (v: unknown) => void;
    updatePreferences
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          })
      )
      .mockImplementation(async (p: object) => ({
        ...STORED,
        notifyBefore24h: true,
        ...p,
      }));
    const user = userEvent.setup();
    render(<NotificationPreferences />);

    await user.click(await screen.findByRole("switch", { name: /before24h/ }));
    await user.click(screen.getByRole("switch", { name: /before2h/ }));
    // Only one write is on the wire while the first is unanswered.
    expect(updatePreferences).toHaveBeenCalledTimes(1);
    releaseFirst({ ...STORED, notifyBefore24h: true });

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(2));
    expect(updatePreferences.mock.calls[0][0]).toEqual({ notifyBefore24h: true });
    expect(updatePreferences.mock.calls[1][0]).toEqual({ notifyBefore2h: false });
    await waitFor(() => expect(screen.getByRole("switch", { name: /before24h/ })).toBeChecked());
    expect(screen.getByRole("switch", { name: /before2h/ })).not.toBeChecked();
  });

  it("a load failure is not shown as loaded defaults", async () => {
    getPreferences.mockRejectedValue(new Error("down"));
    render(<NotificationPreferences />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(addToast).toHaveBeenCalledWith("error", "down");

    getPreferences.mockResolvedValue(STORED);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(await screen.findByRole("switch", { name: /before2h/ })).toBeChecked();
  });

  it("a failed write is retried with the next one when a newer toggle was queued behind it", async () => {
    let failFirst!: (e: Error) => void;
    updatePreferences
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            failFirst = reject;
          })
      )
      .mockImplementation(async (p: object) => ({ ...STORED, ...p }));
    const user = userEvent.setup();
    render(<NotificationPreferences />);

    await user.click(await screen.findByRole("switch", { name: /before24h/ }));
    await user.click(screen.getByRole("switch", { name: /before2h/ }));
    failFirst(new Error("offline"));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(2));
    expect(updatePreferences.mock.calls[1][0]).toEqual({
      notifyBefore24h: true,
      notifyBefore2h: false,
    });
  });
});
