import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const flightsApiMock = vi.hoisted(() => ({
  bulkRefreshPreview: vi.fn(),
  bulkRefreshRun: vi.fn(),
}));

vi.mock("../../../lib/api/flights", () => ({ flightsApi: flightsApiMock }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "provider" in o ? `${k}[${String(o.provider)}]` : k,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "user-a" } }),
}));

import BulkRefreshCard from "../BulkRefreshCard";

/**
 * Silent-failure review 2026-09-26, finding 6: a refused AeroDataBox key made
 * every leg of a bulk refresh "no provider data". The server now counts those
 * legs as failed and names the provider; the card has to say it.
 */
describe("BulkRefreshCard — a provider failure is named, not counted as 'no data'", () => {
  it("shows which provider refused, once, for a batch of refused legs", async () => {
    flightsApiMock.bulkRefreshPreview.mockResolvedValue({
      remaining: 2,
      hasHistoricalProvider: true,
      aerodataboxQuota: null,
    });
    const failure = { provider: "aerodatabox", outcome: "auth" };
    flightsApiMock.bulkRefreshRun.mockResolvedValue({
      scanned: 2,
      updated: 0,
      noData: 0,
      alreadyComplete: 0,
      failed: 2,
      remaining: 2,
      results: [
        {
          flightId: "a",
          flightNumber: "LH1",
          outcome: "failed",
          reason: "provider_failed",
          providerFailures: [failure],
        },
        {
          flightId: "b",
          flightNumber: "LH2",
          outcome: "failed",
          reason: "provider_failed",
          providerFailures: [failure],
        },
      ],
    });

    render(<BulkRefreshCard />);
    const button = await screen.findByRole("button", {
      name: "settings:apiKeys.bulkRefresh.button",
    });
    await vi.waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    fireEvent.click(await screen.findByText("settings:apiKeys.bulkRefresh.confirmRun"));

    expect(await screen.findAllByText("errors:providerFailure.auth[AeroDataBox]")).toHaveLength(1);
  });
});
