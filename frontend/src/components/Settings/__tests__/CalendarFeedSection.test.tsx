import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CalendarFeedSection from "../CalendarFeedSection";
import { calendarFeedApi } from "../../../lib/api/calendarFeed";

/**
 * "Kalender-Abo" (forgejo#310): the URL is shown once with a copy button and
 * a webcal link; a live URL can be replaced or revoked, each after a question;
 * every failure says what failed in the reader's language, never the server's
 * English, and a clipboard that is not there says so instead of pretending.
 */

vi.mock("../../../lib/api/calendarFeed", () => ({
  calendarFeedApi: { status: vi.fn(), issue: vi.fn(), revoke: vi.fn() },
}));

let demo = false;
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo }));

const api = vi.mocked(calendarFeedApi);
const URL_HTTPS = "https://travstats.example/api/v1/calendar/ts_cal_abc.ics";
const URL_WEBCAL = "webcal://travstats.example/api/v1/calendar/ts_cal_abc.ics";

const none = { enabled: true, active: false, createdAt: null, lastUsedAt: null };
const live = {
  enabled: true,
  active: true,
  createdAt: "2030-05-20T10:00:00.000Z",
  lastUsedAt: null,
};

/** An axios-shaped refusal with the server's code. */
const refusal = (status: number, code: string) =>
  Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    response: { status, data: { error: "English prose", code } },
  });

/** Answers the confirm dialog with its confirm button. */
async function confirmDialog(name: string): Promise<void> {
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name }));
}

describe("CalendarFeedSection", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    demo = false;
    api.status.mockResolvedValue(none);
    api.issue.mockResolvedValue({
      url: URL_HTTPS,
      webcalUrl: URL_WEBCAL,
      createdAt: "2030-05-20T10:00:00.000Z",
    });
    api.revoke.mockResolvedValue();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  });

  it("creates a link and shows it once, with copy and a webcal link", async () => {
    render(<CalendarFeedSection />);
    expect(await screen.findByText("settings:calendarFeed.stateNone")).toBeTruthy();
    api.status.mockResolvedValue(live);

    await userEvent.click(screen.getByRole("button", { name: "settings:calendarFeed.create" }));

    const field = await screen.findByLabelText("settings:calendarFeed.urlLabel");
    expect((field as HTMLInputElement).value).toBe(URL_HTTPS);
    expect(screen.getByText("settings:calendarFeed.shownOnce")).toBeTruthy();
    const open = screen.getByRole("link", { name: "settings:calendarFeed.openInCalendar" });
    expect(open.getAttribute("href")).toBe(URL_WEBCAL);
    // A first link needs no question: nothing is replaced.
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "settings:calendarFeed.copy" }));
    expect(writeText).toHaveBeenCalledWith(URL_HTTPS);
    expect(await screen.findByText("settings:calendarFeed.copied")).toBeTruthy();
    expect(await screen.findByText("settings:calendarFeed.stateActive")).toBeTruthy();
  });

  it("says the copy failed where there is no clipboard, and keeps the link selectable", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    render(<CalendarFeedSection />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settings:calendarFeed.create" })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "settings:calendarFeed.copy" })
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(await screen.findByText("settings:calendarFeed.copyFailed")).toBeTruthy();
    expect(screen.getByLabelText("settings:calendarFeed.urlLabel")).toBeTruthy();
  });

  it("asks before replacing a live link, and does nothing when declined", async () => {
    api.status.mockResolvedValue(live);
    render(<CalendarFeedSection />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settings:calendarFeed.regenerate" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("settings:calendarFeed.confirmRegenerate")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.issue).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "settings:calendarFeed.regenerate" }));
    await confirmDialog("settings:calendarFeed.regenerate");
    await waitFor(() => expect(api.issue).toHaveBeenCalledTimes(1));
  });

  it("revokes a live link after asking", async () => {
    api.status.mockResolvedValue(live);
    render(<CalendarFeedSection />);
    expect(await screen.findByText(/settings:calendarFeed.neverUsed/)).toBeTruthy();
    api.status.mockResolvedValue(none);
    await userEvent.click(screen.getByRole("button", { name: "settings:calendarFeed.revoke" }));
    await confirmDialog("settings:calendarFeed.revoke");
    await waitFor(() => expect(api.revoke).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("settings:calendarFeed.stateNone")).toBeTruthy();
  });

  it("says the feed is switched off when the server refuses with CALENDAR_FEED_DISABLED", async () => {
    api.issue.mockRejectedValue(refusal(409, "CALENDAR_FEED_DISABLED"));
    render(<CalendarFeedSection />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settings:calendarFeed.create" })
    );
    expect(await screen.findByText("settings:calendarFeed.errors.disabled")).toBeTruthy();
    expect(screen.queryByText("English prose")).toBeNull();
    expect(screen.queryByLabelText("settings:calendarFeed.urlLabel")).toBeNull();
  });

  it("says a revoke failed instead of pretending it worked", async () => {
    api.status.mockResolvedValue(live);
    api.revoke.mockRejectedValue(refusal(500, "INTERNAL"));
    render(<CalendarFeedSection />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settings:calendarFeed.revoke" })
    );
    await confirmDialog("settings:calendarFeed.revoke");
    expect(await screen.findByText("settings:calendarFeed.errors.revoke")).toBeTruthy();
    expect(screen.getByText("settings:calendarFeed.stateActive")).toBeTruthy();
  });

  it("says when the state cannot be loaded, and loads it again on request", async () => {
    api.status.mockRejectedValueOnce(new Error("down"));
    render(<CalendarFeedSection />);
    expect(await screen.findByText(/settings:calendarFeed.loadFailed/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "settings:calendarFeed.retry" }));
    expect(await screen.findByText("settings:calendarFeed.stateNone")).toBeTruthy();
    expect(screen.queryByText(/settings:calendarFeed.loadFailed/)).toBeNull();
  });

  it("tells the reader the feed is not available when the instance has it off", async () => {
    api.status.mockResolvedValue({ ...none, enabled: false });
    render(<CalendarFeedSection />);
    expect(await screen.findByText("settings:calendarFeed.unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "settings:calendarFeed.create" })).toBeNull();
  });

  it("offers the shared demo account no button to mint a link", async () => {
    demo = true;
    render(<CalendarFeedSection />);
    expect(await screen.findByText("settings:calendarFeed.stateNone")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "settings:calendarFeed.create" })).toBeNull();
  });
});
