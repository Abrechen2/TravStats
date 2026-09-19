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
});
