import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
  }),
}));
vi.mock("../../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  test: vi.fn(),
  discover: vi.fn(),
  rules: vi.fn(async () => []),
  setGeocodeLocations: vi.fn(),
  saveRules: vi.fn(),
}));
vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { choices: vi.fn(async () => ({ places: [], trips: [] })) },
}));
vi.mock("../../../../lib/api/calendarSources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/calendarSources")>()),
  calendarSourcesApi: api,
}));

import CalendarSourcesSection from "../CalendarSourcesSection";

const SOURCE = {
  id: "s1",
  label: "Arbeit",
  kind: "ics" as const,
  enabled: true,
  icsHost: "calendar.example.com",
  caldavUrl: null,
  caldavUsername: null,
  credentialSet: true,
  collections: [],
  lastStatus: null,
  lastErrorCode: null,
  lastCheckedAt: null,
};
const rejectWith = (error: string, code?: string) =>
  Object.assign(new Error("x"), { response: { status: 400, data: { error, code } } });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  api.list.mockResolvedValue({ sources: [SOURCE], blocked: null, geocodeLocations: false });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.values(api).forEach((f) => f.mockReset());
  api.rules.mockResolvedValue([]);
});

describe("CalendarSourcesSection", () => {
  it("shows the host of an ICS source, never its address", async () => {
    render(<CalendarSourcesSection />);
    expect(await screen.findByText(/calendar\.example\.com/)).toBeTruthy();
  });

  it("names the case of a failed test, not just that it failed", async () => {
    api.test.mockRejectedValue(rejectWith("invalidUrl", "PRIVATE_TARGET"));
    render(<CalendarSourcesSection />);
    await userEvent.click(await screen.findByText("suggestionSources:calendar.test.button"));
    expect(
      await screen.findByText("suggestionSources:calendar.failure.code.PRIVATE_TARGET")
    ).toBeTruthy();
  });

  it("names a skipped calendar and skipped appointments in a partly read test", async () => {
    api.test.mockResolvedValue({
      ok: true,
      events: 3,
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-12-01T00:00:00.000Z",
      skippedRules: 0,
      skippedEvents: 2,
      failedCollections: [{ name: "Work", code: "CALENDAR_PARSE" }],
    });
    render(<CalendarSourcesSection />);
    await userEvent.click(await screen.findByText("suggestionSources:calendar.test.button"));
    const line = await screen.findByText(/calendar\.test\.failedCollection/);
    expect(line.textContent).toContain("calendar.test.skippedEvents");
  });

  it("falls back to the fixed kind for a code it does not name", async () => {
    api.test.mockRejectedValue(rejectWith("auth", "SOMETHING_NEW"));
    render(<CalendarSourcesSection />);
    await userEvent.click(await screen.findByText("suggestionSources:calendar.test.button"));
    expect(await screen.findByText("suggestionSources:calendar.failure.kind.auth")).toBeTruthy();
  });

  it("keeps place lookups off until the account switches them on", async () => {
    api.setGeocodeLocations.mockResolvedValue(true);
    render(<CalendarSourcesSection />);
    const toggle = (await screen.findByLabelText(
      "suggestionSources:calendar.geocode.label"
    )) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    await userEvent.click(toggle);
    await waitFor(() => expect(api.setGeocodeLocations).toHaveBeenCalledWith(true));
  });

  it("says when the server switched calendars off", async () => {
    api.list.mockResolvedValue({ sources: [], blocked: "service_off", geocodeLocations: false });
    render(<CalendarSourcesSection />);
    expect(await screen.findByText("suggestionSources:calendar.blocked.service_off")).toBeTruthy();
  });

  it("tells iCloud/Google users under the CalDAV password to use an app-specific password", async () => {
    api.list.mockResolvedValue({ sources: [], blocked: null, geocodeLocations: false });
    render(<CalendarSourcesSection />);
    await userEvent.click(await screen.findByText("suggestionSources:calendar.add"));
    await userEvent.click(screen.getByText("suggestionSources:calendar.form.caldav"));
    expect(
      screen.getByText(/suggestionSources:calendar\.form\.appPasswordHint/)
    ).toBeInTheDocument();
  });

  it("adds a CalDAV source with the calendars picked after discovery", async () => {
    api.list.mockResolvedValue({ sources: [], blocked: null, geocodeLocations: false });
    api.discover.mockResolvedValue([
      { href: "https://dav.example.com/cal/work/", name: "Arbeit" },
      { href: "https://dav.example.com/cal/home/", name: "Privat" },
    ]);
    api.add.mockResolvedValue(SOURCE);
    render(<CalendarSourcesSection />);
    await userEvent.click(await screen.findByText("suggestionSources:calendar.add"));
    await userEvent.click(screen.getByText("suggestionSources:calendar.form.caldav"));
    await userEvent.type(screen.getByLabelText("suggestionSources:calendar.form.label"), "Arbeit");
    await userEvent.type(
      screen.getByLabelText("suggestionSources:calendar.form.server"),
      "https://dav.example.com/"
    );
    await userEvent.type(screen.getByLabelText("suggestionSources:calendar.form.username"), "me");
    await userEvent.type(screen.getByLabelText("suggestionSources:calendar.form.password"), "pw");
    await userEvent.click(screen.getByText("suggestionSources:calendar.form.discover"));
    await userEvent.click(await screen.findByLabelText("Privat"));
    await userEvent.click(screen.getByText("suggestionSources:calendar.form.save"));
    await waitFor(() =>
      expect(api.add).toHaveBeenCalledWith({
        kind: "caldav",
        label: "Arbeit",
        url: "https://dav.example.com/",
        username: "me",
        password: "pw",
        collections: [{ href: "https://dav.example.com/cal/work/", name: "Arbeit" }],
      })
    );
  });
});
