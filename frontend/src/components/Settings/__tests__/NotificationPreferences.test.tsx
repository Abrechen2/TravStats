import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

type Row = { enabled: boolean; leadHours: number[]; channel: "app" | "mail" | "both" };
const row = (over: Partial<Row> = {}): Row => ({
  enabled: true,
  leadHours: [24, 2],
  channel: "both",
  ...over,
});
const fixture = (over: Record<string, unknown> = {}) => ({
  notificationEmail: "a@example.com",
  notifyBefore24h: true,
  notifyBefore2h: true,
  domains: {
    flight: row(),
    cruise: row({ leadHours: [24], channel: "mail" }),
    rail: row({ enabled: false, leadHours: [], channel: "app" }),
    bus: row(),
    ferry: row(),
    lodging: row({ leadHours: [48, 24], channel: "app" }),
  },
  mail: { available: true, reason: null },
  push: { available: true, reason: null },
  ...over,
});
const STORED = fixture();

const domainRow = (d: string): HTMLElement =>
  document.querySelector(`tr[data-domain="${d}"]`) as HTMLElement;
const when = (d: string) =>
  within(within(domainRow(d)).getByRole("group", { name: "settings:notifications.whenGroup" }));
const where = (d: string) =>
  within(within(domainRow(d)).getByRole("group", { name: "settings:notifications.whereGroup" }));
const echo = (patch: { domains?: Record<string, object> }) => {
  const next = structuredClone(STORED) as typeof STORED & { domains: Record<string, object> };
  for (const [d, change] of Object.entries(patch.domains ?? {})) {
    next.domains[d] = { ...next.domains[d], ...change };
  }
  return next;
};

describe("NotificationPreferences (reminders per domain)", () => {
  beforeEach(() => {
    getPreferences.mockReset().mockResolvedValue(STORED);
    updatePreferences.mockReset().mockImplementation(async (p) => echo(p));
    addToast.mockReset();
  });

  it("renders every domain from the GET fixture, with its chips, switch and no save button", async () => {
    render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(document.querySelectorAll("tr[data-domain]")).toHaveLength(6);
    expect(within(domainRow("flight")).getByRole("switch")).toBeChecked();
    expect(within(domainRow("rail")).getByRole("switch")).not.toBeChecked();
    expect(
      when("flight").getByRole("button", { name: "settings:notifications.lead24" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      when("cruise").getByRole("button", { name: "settings:notifications.lead2" })
    ).toHaveAttribute("aria-pressed", "false");
    // channel "both" presses both chips, "mail" only the mail chip
    expect(
      where("flight").getByRole("button", { name: "settings:notifications.channelApp" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      where("cruise").getByRole("button", { name: "settings:notifications.channelApp" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      where("cruise").getByRole("button", { name: "settings:notifications.channelMail" })
    ).toHaveAttribute("aria-pressed", "true");
    // lodging carries a custom 48 h: Eigene is on and shows it
    expect(when("lodging").getByRole("spinbutton")).toHaveValue(48);
  });

  it("the switch sends only that domain's enabled flag", async () => {
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    await user.click(await within(await waitDomain("rail")).findByRole("switch"));
    expect(updatePreferences).toHaveBeenCalledWith({ domains: { rail: { enabled: true } } });
  });

  it("a preset chip sends the new lead list, sorted descending", async () => {
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    await user.click(when("cruise").getByRole("button", { name: "settings:notifications.lead2" }));
    expect(updatePreferences).toHaveBeenCalledWith({ domains: { cruise: { leadHours: [24, 2] } } });
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    await user.click(when("flight").getByRole("button", { name: "settings:notifications.lead24" }));
    expect(updatePreferences).toHaveBeenLastCalledWith({ domains: { flight: { leadHours: [2] } } });
  });

  it("the channel chips send app, mail or both, and the last active chip cannot be switched off", async () => {
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    await user.click(
      where("flight").getByRole("button", { name: "settings:notifications.channelMail" })
    );
    expect(updatePreferences).toHaveBeenLastCalledWith({ domains: { flight: { channel: "app" } } });
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    await user.click(
      where("cruise").getByRole("button", { name: "settings:notifications.channelApp" })
    );
    expect(updatePreferences).toHaveBeenLastCalledWith({
      domains: { cruise: { channel: "both" } },
    });
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(2));
    await user.click(
      where("lodging").getByRole("button", { name: "settings:notifications.channelApp" })
    );
    expect(updatePreferences).toHaveBeenCalledTimes(2);
  });

  it("Eigene opens a number field; only 1-168 is sent, 24 and 2 are refused, and only one custom lead exists", async () => {
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    await user.click(
      when("flight").getByRole("button", { name: "settings:notifications.leadCustom" })
    );
    const field = when("flight").getByRole("spinbutton");
    expect(updatePreferences).not.toHaveBeenCalled();

    for (const bad of ["0", "169", "24", "2", ""]) {
      await user.clear(field);
      if (bad) await user.type(field, bad);
      await user.tab();
      expect(updatePreferences).not.toHaveBeenCalled();
      expect(within(domainRow("flight")).getByRole("alert")).toBeInTheDocument();
    }

    await user.clear(field);
    await user.type(field, "12");
    await user.tab();
    expect(updatePreferences).toHaveBeenCalledWith({
      domains: { flight: { leadHours: [24, 12, 2] } },
    });
  });

  it("changing an existing custom lead replaces it instead of adding a second one; Eigene off drops it", async () => {
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    const field = when("lodging").getByRole("spinbutton");
    await user.clear(field);
    await user.type(field, "72");
    await user.tab();
    expect(updatePreferences).toHaveBeenLastCalledWith({
      domains: { lodging: { leadHours: [72, 24] } },
    });
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    await user.click(
      when("lodging").getByRole("button", { name: "settings:notifications.leadCustom" })
    );
    expect(updatePreferences).toHaveBeenLastCalledWith({
      domains: { lodging: { leadHours: [24] } },
    });
  });

  it("an off domain greys its chips and the custom field", async () => {
    render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    for (const b of [
      ...when("rail").getAllByRole("button"),
      ...where("rail").getAllByRole("button"),
    ]) {
      expect(b).toBeDisabled();
    }
    for (const b of where("cruise").getAllByRole("button")) expect(b).toBeEnabled();
  });

  it("mail chip is disabled with its reason when there is no address", async () => {
    getPreferences.mockResolvedValue(fixture({ mail: { available: false, reason: "no_email" } }));
    render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    const chip = where("lodging").getByRole("button", {
      name: "settings:notifications.channelMail",
    });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAccessibleDescription("settings:notifications.mailReason.no_email");
  });

  it("app chip is disabled with its reason when no device is paired; a missing relay keeps it usable", async () => {
    getPreferences.mockResolvedValue(
      fixture({ push: { available: false, reason: "no_device_token" } })
    );
    const { unmount } = render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    const chip = where("cruise").getByRole("button", { name: "settings:notifications.channelApp" });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAccessibleDescription("settings:notifications.pushStatus.no_device_token");
    unmount();

    getPreferences.mockResolvedValue(fixture({ push: { available: false, reason: "no_relay" } }));
    render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    expect(
      where("flight").getByRole("button", { name: "settings:notifications.channelApp" })
    ).toBeEnabled();
    expect(screen.getByText("settings:notifications.pushStatus.no_relay")).toBeInTheDocument();
  });

  it("an unavailable channel can still be switched off when it was selected, so a row never gets stuck on it", async () => {
    getPreferences.mockResolvedValue(
      fixture({ push: { available: false, reason: "no_device_token" } })
    );
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    await user.click(
      where("flight").getByRole("button", { name: "settings:notifications.channelApp" })
    );
    expect(updatePreferences).toHaveBeenCalledWith({ domains: { flight: { channel: "mail" } } });
  });

  it("a server answer does not overwrite an address that is still being typed", async () => {
    let release!: (v: unknown) => void;
    updatePreferences.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    await user.click(within(domainRow("bus")).getByRole("switch"));
    const field = screen.getByLabelText("settings:notifications.mailCard");
    await user.clear(field);
    await user.type(field, "new@example.com");
    release(echo({ domains: { bus: { enabled: false } } }));
    await waitFor(() => expect(within(domainRow("bus")).getByRole("switch")).not.toBeChecked());
    expect(field).toHaveValue("new@example.com");
    await user.tab();
    expect(updatePreferences).toHaveBeenLastCalledWith({ notificationEmail: "new@example.com" });
  });

  it("a failed write is shown on its row, the control returns to the stored state, and retry sends it again", async () => {
    updatePreferences.mockRejectedValueOnce(new Error("nope"));
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    const sw = within(domainRow("flight")).getByRole("switch");
    await user.click(sw);

    const alert = await within(domainRow("flight")).findByRole("alert");
    expect(alert).toHaveTextContent("settings:notifications.rowFailed");
    expect(sw).toBeChecked();
    expect(addToast).toHaveBeenCalledWith("error", "nope");
    expect(within(domainRow("bus")).queryByRole("alert")).toBeNull();

    await user.click(within(alert).getByRole("button"));
    expect(updatePreferences).toHaveBeenLastCalledWith({ domains: { flight: { enabled: false } } });
    await waitFor(() => expect(within(domainRow("flight")).queryByRole("alert")).toBeNull());
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(2));
  });

  it("two quick edits go out one at a time, in order, and a failed first one rides with the second", async () => {
    let failFirst!: (e: Error) => void;
    updatePreferences
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            failFirst = reject;
          })
      )
      .mockImplementation(async (p) => echo(p));
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    await screen.findByTestId("reminders-table");
    await user.click(within(domainRow("flight")).getByRole("switch"));
    await user.click(when("cruise").getByRole("button", { name: "settings:notifications.lead2" }));
    await user.click(within(domainRow("bus")).getByRole("switch"));
    expect(updatePreferences).toHaveBeenCalledTimes(1);
    failFirst(new Error("offline"));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(2));
    expect(updatePreferences.mock.calls[1][0]).toEqual({
      domains: {
        flight: { enabled: false },
        cruise: { leadHours: [24, 2] },
        bus: { enabled: false },
      },
    });
  });

  it("writes the address when the field is left, and only if it changed", async () => {
    updatePreferences.mockResolvedValue({ ...STORED, notificationEmail: null });
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    const field = await screen.findByLabelText("settings:notifications.mailCard");
    await user.click(field);
    await user.tab();
    expect(updatePreferences).not.toHaveBeenCalled();
    await user.clear(field);
    await user.tab();
    expect(updatePreferences).toHaveBeenCalledWith({ notificationEmail: null });
  });

  it("a load failure is not shown as loaded defaults", async () => {
    getPreferences.mockRejectedValue(new Error("down"));
    render(<NotificationPreferences />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(addToast).toHaveBeenCalledWith("error", "down");
    getPreferences.mockResolvedValue(STORED);
    await userEvent.setup().click(screen.getByRole("button"));
    await screen.findByTestId("reminders-table");
  });
});

async function waitDomain(d: string): Promise<HTMLElement> {
  await screen.findByTestId("reminders-table");
  return domainRow(d);
}
