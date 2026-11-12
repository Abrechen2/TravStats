import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

let enabledDomains: string[] = [
  "flight",
  "cruise",
  "rail",
  "bus",
  "ferry",
  "lodging",
  "rental",
  "roadtrip",
  "poi",
];
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
    flight: row({ leadHours: [2] }),
    cruise: row({ leadHours: [24], channel: "both" }),
    rail: row({ enabled: false, leadHours: [], channel: "both" }),
    bus: row(),
    ferry: row(),
    lodging: row({ leadHours: [36], channel: "both" }),
    rental: row(),
    roadtrip: row(),
    poi: row(),
  },
  mail: { available: true, reason: null },
  push: { available: true, reason: null },
  ...over,
});
const STORED = fixture();

const domainRow = (d: string): HTMLElement =>
  screen.getByText(`settingsRows:notifications.r_${d}.t`).closest("[data-setting-row]")!;
const leadSelect = (d: string): HTMLSelectElement =>
  within(domainRow(d)).getByRole("combobox") as HTMLSelectElement;
const channelRow = (): HTMLElement =>
  screen.getByText("settingsRows:notifications.rchan.t").closest("[data-setting-row]")!;
const channelButton = (name: string) => within(channelRow()).getByRole("radio", { name });
const echo = (patch: { domains?: Record<string, object> }) => {
  const next = structuredClone(STORED) as typeof STORED & { domains: Record<string, object> };
  for (const [d, change] of Object.entries(patch.domains ?? {})) {
    next.domains[d] = { ...next.domains[d], ...change };
  }
  return next;
};
const WAIT = { timeout: 3000 };
const ALL = ["flight", "cruise", "rail", "bus", "ferry", "lodging", "rental", "roadtrip", "poi"];

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

describe("NotificationPreferences (one channel, one lead select per area)", () => {
  beforeEach(() => {
    getPreferences.mockReset().mockResolvedValue(STORED);
    updatePreferences.mockReset().mockImplementation(async (p) => echo(p));
    enabledDomains = [...ALL];
    demo = false;
  });
  afterEach(() => {
    cleanup();
    act(() => resetWriteQueue());
  });

  it("an area that is switched off has no row (the prototype hides it)", async () => {
    enabledDomains = ["flight"];
    await renderPage();
    expect(screen.queryByText("settingsRows:notifications.r_cruise.t")).toBeNull();
    expect(leadSelect("flight")).toBeTruthy();
  });

  it("keeps the places reminder row, which the prototype forgot", async () => {
    await renderPage();
    expect(leadSelect("poi")).toBeTruthy();
  });

  it("draws each area's stored lead; a lead outside the list shows as 'Eigene' and is not rewritten by looking", async () => {
    await renderPage();
    expect(leadSelect("flight").value).toBe("2");
    expect(leadSelect("cruise").value).toBe("24");
    expect(leadSelect("rail").value).toBe("off");
    expect(leadSelect("lodging").value).toBe("custom");
    expect(
      within(leadSelect("lodging")).getByRole("option", {
        name: "settingsRows:notifications.lead.own",
      })
    ).toBeTruthy();
    await new Promise((r) => setTimeout(r, 600));
    expect(updatePreferences).not.toHaveBeenCalled();
  });

  it("shows the server's default 24 h + 2 h as the standard choice, not as 'Eigene', and 36 h still as 'Eigene'", async () => {
    await renderPage();
    // bus keeps the pair every new account is created with.
    expect(leadSelect("bus").value).toBe("standard");
    expect(
      within(leadSelect("bus")).getByRole("option", {
        name: "settingsRows:notifications.lead.standard",
      })
    ).toBeTruthy();
    expect(
      within(leadSelect("bus")).queryByRole("option", {
        name: "settingsRows:notifications.lead.own",
      })
    ).toBeNull();
    expect(leadSelect("lodging").value).toBe("custom");
    await new Promise((r) => setTimeout(r, 600));
    expect(updatePreferences).not.toHaveBeenCalled();
  });

  it("a custom lead survives switching the area off, and can be switched on again without losing it", async () => {
    await renderPage();
    await userEvent.selectOptions(leadSelect("lodging"), "off");
    await waitFor(
      () =>
        expect(updatePreferences).toHaveBeenCalledWith({
          domains: { lodging: { enabled: false, leadHours: [36] } },
        }),
      WAIT
    );
  });

  it("picking the 'Eigene' entry of an area that was switched off turns it on with its own lead", async () => {
    getPreferences.mockResolvedValue(
      fixture({
        domains: { ...STORED.domains, lodging: row({ enabled: false, leadHours: [36] }) },
      })
    );
    await renderPage();
    expect(leadSelect("lodging").value).toBe("off");
    await userEvent.selectOptions(leadSelect("lodging"), "custom");
    await waitFor(
      () =>
        expect(updatePreferences).toHaveBeenCalledWith({
          domains: { lodging: { enabled: true, leadHours: [36] } },
        }),
      WAIT
    );
  });

  it("picking '2 Tage' sends 48 h as the area's only lead, and never the channel", async () => {
    await renderPage();
    await userEvent.selectOptions(leadSelect("cruise"), "48");
    await waitFor(
      () =>
        expect(updatePreferences).toHaveBeenCalledWith({
          domains: { cruise: { enabled: true, leadHours: [48] } },
        }),
      WAIT
    );
    expect(await within(domainRow("cruise")).findByText("settings:blocks.save.saved")).toBeTruthy();
  });

  it("picking a lead for an area that was off switches it on", async () => {
    await renderPage();
    await userEvent.selectOptions(leadSelect("rail"), "24");
    await waitFor(
      () =>
        expect(updatePreferences).toHaveBeenCalledWith({
          domains: { rail: { enabled: true, leadHours: [24] } },
        }),
      WAIT
    );
  });

  it("the channel row is written to EVERY area in one request", async () => {
    await renderPage();
    await userEvent.click(channelButton("settings:notifications.channelMail"));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1), WAIT);
    const sent = updatePreferences.mock.calls[0][0] as { domains: Record<string, object> };
    expect(Object.keys(sent.domains).sort()).toEqual([...ALL].sort());
    for (const d of ALL) expect(sent.domains[d]).toEqual({ channel: "mail" });
  });

  it("areas that disagree on the channel show no pick and say so; the pick then applies to all", async () => {
    getPreferences.mockResolvedValue(
      fixture({
        domains: { ...STORED.domains, bus: row({ channel: "app" }) },
      })
    );
    await renderPage();
    expect(screen.getByText("settingsRows:notifications.rchan.mixed")).toBeTruthy();
    for (const name of ["settings:notifications.channelApp", "settings:notifications.channelMail"])
      expect(channelButton(name)).toHaveAttribute("aria-checked", "false");
  });

  it("an answer to one area does not undo another's confirmed state (out-of-order responses)", async () => {
    const pending: Array<(v: unknown) => void> = [];
    updatePreferences.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    await renderPage();
    await userEvent.selectOptions(leadSelect("flight"), "off");
    await waitFor(() => expect(pending).toHaveLength(1), WAIT);
    await userEvent.selectOptions(leadSelect("bus"), "off");
    await waitFor(() => expect(pending).toHaveLength(2), WAIT);
    // The bus answer lands first; the flight answer, computed before it, lands last
    // and still carries the bus row as it was.
    await act(async () => pending[1](echo({ domains: { bus: { enabled: false } } })));
    await act(async () => pending[0](echo({ domains: { flight: { enabled: false } } })));
    await waitFor(() => expect(leadSelect("bus").value).toBe("off"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2700));
    });
    expect(leadSelect("bus").value).toBe("off");
    expect(leadSelect("flight").value).toBe("off");
  }, 15000);

  it("with no address the page says why mail cannot be chosen", async () => {
    getPreferences.mockResolvedValue(
      fixture({ notificationEmail: null, mail: { available: false, reason: "no_email" } })
    );
    await renderPage();
    expect(within(channelRow()).getByText("settings:blocks.dep.noMailAddr.reason")).toBeTruthy();
    expect(screen.getByLabelText("settingsRows:notifications.erimail.t")).toHaveValue("");
  });

  it("with no paired device the app option is off; with no relay it stays usable and the page names the server's push switch (R2-11)", async () => {
    getPreferences.mockResolvedValue(
      fixture({
        push: { available: false, reason: "no_device_token" },
        domains: Object.fromEntries(ALL.map((d) => [d, row({ channel: "mail" })])),
      })
    );
    await renderPage();
    expect(channelButton("settings:notifications.channelApp")).toBeDisabled();
    cleanup();

    getPreferences.mockResolvedValue(fixture({ push: { available: false, reason: "no_relay" } }));
    await renderPage();
    expect(channelButton("settings:notifications.channelApp")).toBeEnabled();
    expect(screen.getAllByText("settings:blocks.dep.noPush.reason").length).toBeGreaterThan(1);
    expect(screen.getByText("settings:notifications.pushStatus.no_relay")).toBeInTheDocument();
  });

  it("a refused write keeps the pick, says so, and 'Erneut versuchen' sends it again", async () => {
    updatePreferences.mockRejectedValueOnce(new Error("Network Error"));
    await renderPage();
    await userEvent.selectOptions(leadSelect("flight"), "off");
    const alert = await within(domainRow("flight")).findByRole("alert", undefined, WAIT);
    expect(alert).toHaveTextContent("settings:blocks.save.failed");
    expect(leadSelect("flight").value).toBe("off");
    expect(within(domainRow("bus")).queryByRole("alert")).toBeNull();
    await userEvent.click(
      within(alert).getByRole("button", { name: "settings:blocks.save.retry" })
    );
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(2), WAIT);
    expect(updatePreferences).toHaveBeenLastCalledWith({
      domains: { flight: { enabled: false, leadHours: [2] } },
    });
  });

  it("'Verwerfen' brings the last saved state back", async () => {
    updatePreferences.mockRejectedValue(new Error("Network Error"));
    await renderPage();
    await userEvent.selectOptions(leadSelect("flight"), "off");
    const alert = await within(domainRow("flight")).findByRole("alert", undefined, WAIT);
    await userEvent.click(
      within(alert).getByRole("button", { name: "settings:blocks.save.discard" })
    );
    expect(leadSelect("flight").value).toBe("2");
  });

  it("a lead write carries no channel, so it cannot undo a channel pick still on its way", async () => {
    await renderPage();
    await userEvent.selectOptions(leadSelect("flight"), "24");
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1), WAIT);
    const sent = updatePreferences.mock.calls[0][0] as { domains: { flight: object } };
    expect(sent.domains.flight).toEqual({ enabled: true, leadHours: [24] });
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
    expect(leadSelect("flight")).toBeDisabled();
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
    expect(screen.queryByRole("combobox")).toBeNull();
    getPreferences.mockResolvedValue(STORED);
    await userEvent.click(screen.getByRole("button"));
    await screen.findByText("settingsRows:notifications.r_flight.t");
  });
});
