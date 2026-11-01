import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

let enabledDomains: string[] = ["flight", "cruise", "rail", "bus", "ferry", "lodging"];
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: enabledDomains,
    isEnabled: (d: string) => enabledDomains.includes(d),
  }),
}));
let demo = false;
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo }));

const getPreferences = vi.fn();
const updatePreferences = vi.fn();
vi.mock("../../../lib/api", () => ({
  notificationsApi: {
    getPreferences: () => getPreferences(),
    updatePreferences: (p: unknown) => updatePreferences(p),
  },
}));

import NotificationPreferences from "../NotificationPreferences";
import { resetWriteQueue } from "../../ui/settings/writeQueue";

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
  screen.getByText(`settingsRows:notifications.r_${d}.t`).closest("[data-setting-row]")!;
const chip = (d: string, name: string) => within(domainRow(d)).getByRole("button", { name });
const echo = (patch: { domains?: Record<string, object> }) => {
  const next = structuredClone(STORED) as typeof STORED & { domains: Record<string, object> };
  for (const [d, change] of Object.entries(patch.domains ?? {})) {
    next.domains[d] = { ...next.domains[d], ...change };
  }
  return next;
};
const WAIT = { timeout: 3000 };

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <NotificationPreferences />
      </MemoryRouter>
    );
  });
  await screen.findByText("settingsRows:notifications.r_flight.t");
}

describe("NotificationPreferences (reminders per area, rebuilt rows)", () => {
  beforeEach(() => {
    getPreferences.mockReset().mockResolvedValue(STORED);
    updatePreferences.mockReset().mockImplementation(async (p) => echo(p));
    enabledDomains = ["flight", "cruise", "rail", "bus", "ferry", "lodging"];
    demo = false;
  });
  afterEach(() => {
    cleanup();
    act(() => resetWriteQueue());
  });

  it("an area that is switched off shows why, with a jump to Reisearten, and no controls", async () => {
    enabledDomains = ["flight"];
    await renderPage();
    const cruise = domainRow("cruise");
    expect(within(cruise).queryByRole("switch")).toBeNull();
    expect(within(cruise).getByText("settings:notifications.domainOff")).toBeTruthy();
    expect(
      within(cruise).getByRole("button", { name: /settings:notifications.domainOffAction/ })
    ).toBeTruthy();
    expect(within(domainRow("flight")).getByRole("switch")).toBeTruthy();
  });

  it("renders every area from the GET fixture, with no save button", async () => {
    await renderPage();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(within(domainRow("flight")).getByRole("switch")).toBeChecked();
    expect(within(domainRow("rail")).getByRole("switch")).not.toBeChecked();
    expect(chip("flight", "settings:notifications.lead24")).toHaveAttribute("aria-pressed", "true");
    expect(chip("cruise", "settings:notifications.lead2")).toHaveAttribute("aria-pressed", "false");
    expect(chip("cruise", "settings:notifications.channelMail")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(within(domainRow("lodging")).getByRole("spinbutton")).toHaveValue(48);
  });

  it("the switch sends the area's row and shows 'Gespeichert' once the server confirmed", async () => {
    await renderPage();
    await userEvent.click(within(domainRow("rail")).getByRole("switch"));
    await waitFor(
      () =>
        expect(updatePreferences).toHaveBeenCalledWith({
          domains: { rail: { enabled: true, leadHours: [], channel: "app" } },
        }),
      WAIT
    );
    expect(await within(domainRow("rail")).findByText("settings:blocks.save.saved")).toBeTruthy();
  });

  it("quick picks in one area go out as ONE write carrying the last state, sorted descending", async () => {
    await renderPage();
    await userEvent.click(chip("cruise", "settings:notifications.lead2"));
    await userEvent.click(chip("cruise", "settings:notifications.channelApp"));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1), WAIT);
    expect(updatePreferences).toHaveBeenCalledWith({
      domains: { cruise: { enabled: true, leadHours: [24, 2], channel: "both" } },
    });
  });

  it("the last active channel chip cannot be switched off", async () => {
    await renderPage();
    await userEvent.click(chip("lodging", "settings:notifications.channelApp"));
    await new Promise((r) => setTimeout(r, 600));
    expect(updatePreferences).not.toHaveBeenCalled();
  });

  it("Eigene: only 1-168 is sent, 24 and 2 are refused with a message, an existing custom lead is replaced", async () => {
    await renderPage();
    await userEvent.click(chip("flight", "settings:notifications.leadCustom"));
    const field = within(domainRow("flight")).getByRole("spinbutton");
    for (const bad of ["0", "169", "24", "2", ""]) {
      await userEvent.clear(field);
      if (bad) await userEvent.type(field, bad);
      await userEvent.tab();
      expect(within(domainRow("flight")).getByRole("alert")).toBeInTheDocument();
    }
    expect(updatePreferences).not.toHaveBeenCalled();
    await userEvent.clear(field);
    await userEvent.type(field, "12");
    await userEvent.tab();
    await waitFor(
      () =>
        expect(updatePreferences).toHaveBeenCalledWith({
          domains: { flight: { enabled: true, leadHours: [24, 12, 2], channel: "both" } },
        }),
      WAIT
    );
    const lodging = within(domainRow("lodging")).getByRole("spinbutton");
    await userEvent.clear(lodging);
    await userEvent.type(lodging, "72");
    await userEvent.tab();
    await waitFor(
      () =>
        expect(updatePreferences).toHaveBeenCalledWith({
          domains: { lodging: { enabled: true, leadHours: [72, 24], channel: "app" } },
        }),
      WAIT
    );
  });

  it("an area that is off greys its chips", async () => {
    await renderPage();
    const chips = within(domainRow("rail"))
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("aria-pressed"));
    expect(chips).toHaveLength(5);
    for (const b of chips) expect(b).toBeDisabled();
  });

  it("the mail chip is disabled when there is no address and says why", async () => {
    getPreferences.mockResolvedValue(fixture({ mail: { available: false, reason: "no_email" } }));
    await renderPage();
    expect(chip("lodging", "settings:notifications.channelMail")).toBeDisabled();
    expect(
      within(domainRow("flight")).getByText("settings:blocks.dep.noMailAddr.reason")
    ).toBeTruthy();
  });

  it("with no paired device the app chip is disabled; with no relay it stays usable and the row names the server's push switch (R2-11)", async () => {
    getPreferences.mockResolvedValue(
      fixture({ push: { available: false, reason: "no_device_token" } })
    );
    await renderPage();
    expect(chip("cruise", "settings:notifications.channelApp")).toBeDisabled();
    cleanup();

    getPreferences.mockResolvedValue(fixture({ push: { available: false, reason: "no_relay" } }));
    await renderPage();
    expect(chip("flight", "settings:notifications.channelApp")).toBeEnabled();
    expect(screen.getAllByText("settings:blocks.dep.noPush.reason").length).toBeGreaterThan(1);
    expect(screen.getByText("settings:notifications.pushStatus.no_relay")).toBeInTheDocument();
  });

  it("a refused write keeps the pick, says so, and 'Erneut versuchen' sends it again", async () => {
    updatePreferences.mockRejectedValueOnce(new Error("Network Error"));
    await renderPage();
    const sw = within(domainRow("flight")).getByRole("switch");
    await userEvent.click(sw);
    const alert = await within(domainRow("flight")).findByRole("alert", undefined, WAIT);
    expect(alert).toHaveTextContent("settings:blocks.save.failed");
    expect(sw).not.toBeChecked();
    expect(within(domainRow("bus")).queryByRole("alert")).toBeNull();
    await userEvent.click(
      within(alert).getByRole("button", { name: "settings:blocks.save.retry" })
    );
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(2), WAIT);
    expect(updatePreferences).toHaveBeenLastCalledWith({
      domains: { flight: { enabled: false, leadHours: [24, 2], channel: "both" } },
    });
  });

  it("'Verwerfen' brings the last saved state back", async () => {
    updatePreferences.mockRejectedValue(new Error("Network Error"));
    await renderPage();
    await userEvent.click(within(domainRow("flight")).getByRole("switch"));
    const alert = await within(domainRow("flight")).findByRole("alert", undefined, WAIT);
    await userEvent.click(
      within(alert).getByRole("button", { name: "settings:blocks.save.discard" })
    );
    expect(within(domainRow("flight")).getByRole("switch")).toBeChecked();
  });

  it("writes the address when the field is left, only if it changed, and a refusal keeps what was typed", async () => {
    await renderPage();
    const field = screen.getByLabelText("settingsRows:notifications.erimail.t");
    await userEvent.click(field);
    await userEvent.tab();
    await new Promise((r) => setTimeout(r, 600));
    expect(updatePreferences).not.toHaveBeenCalled();

    updatePreferences.mockRejectedValueOnce(new Error("Network Error"));
    await userEvent.clear(field);
    await userEvent.type(field, "new@example.com");
    await userEvent.tab();
    await waitFor(
      () =>
        expect(updatePreferences).toHaveBeenCalledWith({ notificationEmail: "new@example.com" }),
      WAIT
    );
    expect(await screen.findByText(/settings:blocks.save.failed/, undefined, WAIT)).toBeTruthy();
    expect(field).toHaveValue("new@example.com");
  });

  it("the demo account sees the preferences locked, with the reason", async () => {
    demo = true;
    await renderPage();
    expect(within(domainRow("flight")).getByRole("switch")).toBeDisabled();
    expect(screen.getByLabelText("settingsRows:notifications.erimail.t")).toBeDisabled();
    expect(screen.getAllByText("settings:blocks.lock.demo").length).toBeGreaterThan(0);
  });

  it("a load failure is not shown as loaded defaults", async () => {
    getPreferences.mockRejectedValue(new Error("down"));
    await act(async () => {
      render(
        <MemoryRouter>
          <NotificationPreferences />
        </MemoryRouter>
      );
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    getPreferences.mockResolvedValue(STORED);
    await userEvent.click(screen.getByRole("button"));
    await screen.findByText("settingsRows:notifications.r_flight.t");
  });
});
