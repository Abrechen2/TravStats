import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const api = vi.hoisted(() => ({ rules: vi.fn(), saveRules: vi.fn() }));
vi.mock("../../../../lib/api/calendarSources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/calendarSources")>()),
  calendarSourcesApi: api,
}));
vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { choices: vi.fn(async () => ({ places: [], trips: [] })) },
}));

import CalendarRulesEditor from "../CalendarRulesEditor";

const SOURCE = {
  id: "s1",
  label: "Arbeit",
  kind: "ics" as const,
  enabled: true,
  icsHost: "x",
  caldavUrl: null,
  caldavUsername: null,
  credentialSet: true,
  collections: [],
  lastStatus: null,
  lastErrorCode: null,
  lastCheckedAt: null,
};
const rule = (token: string) => ({
  kind: "keyword" as const,
  sourceId: null,
  token,
  matchMode: "contains" as const,
  purpose: "business" as const,
  nameTemplate: null,
  placeId: null,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CalendarRulesEditor", () => {
  it("saves the list in the order shown, after moving a rule up", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    api.rules.mockResolvedValue([rule("WAR"), rule("IBN")]);
    api.saveRules.mockImplementation(async (r) => r);
    render(<CalendarRulesEditor sources={[SOURCE]} disabled={false} />);
    await screen.findAllByTestId("calendar-rule");
    await userEvent.click(screen.getAllByText("suggestionSources:rules.up")[1]);
    await userEvent.click(screen.getByText("suggestionSources:rules.save"));
    await waitFor(() => expect(api.saveRules).toHaveBeenCalledWith([rule("IBN"), rule("WAR")]));
    expect(await screen.findByText("suggestionSources:rules.saved")).toBeTruthy();
  });

  it("says when the rule limit is reached", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    api.rules.mockResolvedValue([rule("WAR")]);
    api.saveRules.mockRejectedValue({ response: { data: { code: "CALENDAR_RULE_LIMIT" } } });
    render(<CalendarRulesEditor sources={[SOURCE]} disabled={false} />);
    await screen.findAllByTestId("calendar-rule");
    await userEvent.click(screen.getByText("suggestionSources:rules.save"));
    expect(await screen.findByText("suggestionSources:rules.limit")).toBeTruthy();
  });
});
