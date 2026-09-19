import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const flightsApiMock = vi.hoisted(() => ({
  bulkRefreshPreview: vi.fn(),
  bulkRefreshRun: vi.fn(),
}));
const isDemoMock = vi.hoisted(() => ({ current: true }));

vi.mock("../../../lib/api/flights", () => ({ flightsApi: flightsApiMock }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({
  useIsDemoAccount: () => isDemoMock.current,
}));

import BulkRefreshCard from "../BulkRefreshCard";

/**
 * Beta audit 2026-09-19, unlisted finding 2: `/settings/account` draws all
 * four general groups on one page, this card among them, and every load fired
 * `GET /flights/refresh-historical-bulk/preview` → 403 with a console error.
 * `rejectDemoQuota` refuses the demo before the handler runs, so the answer
 * was known before the request left.
 */
describe("BulkRefreshCard on the shared demo account", () => {
  beforeEach(() => {
    flightsApiMock.bulkRefreshPreview.mockReset().mockResolvedValue({
      remaining: 12,
      hasHistoricalProvider: true,
      aerodataboxQuota: null,
    });
    flightsApiMock.bulkRefreshRun.mockReset();
    window.sessionStorage.clear();
  });

  it("asks for no preview it already knows will be refused", async () => {
    isDemoMock.current = true;
    render(<BulkRefreshCard />);

    expect(await screen.findByText("settings:apiKeys.bulkRefresh.demoBlocked")).toBeInTheDocument();
    expect(flightsApiMock.bulkRefreshPreview).not.toHaveBeenCalled();
  });

  it("asks for it on a normal account — the case above is not vacuous", async () => {
    isDemoMock.current = false;
    render(<BulkRefreshCard />);

    await waitFor(() => expect(flightsApiMock.bulkRefreshPreview).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("settings:apiKeys.bulkRefresh.demoBlocked")).not.toBeInTheDocument();
  });

  /**
   * The server refuses every `isDemo` account, not only the shared one -- the
   * preview instances' own admin and the local dev admin too (`rejectDemoQuota`,
   * backend middleware/demoGuard.ts). The frontend cannot see that flag, so the
   * first 403 is the only way to learn it. Remembering it for the tab turns
   * "a 403 on every visit to /settings/account" into one per session.
   */
  it("stops asking after the server has refused once", async () => {
    isDemoMock.current = false;
    const refusal = {
      response: { status: 403, data: { error: "DEMO_ACCOUNT_FORBIDDEN", message: "no" } },
    };
    flightsApiMock.bulkRefreshPreview.mockRejectedValue(refusal);

    const first = render(<BulkRefreshCard />);
    expect(await screen.findByText("settings:apiKeys.bulkRefresh.demoBlocked")).toBeInTheDocument();
    expect(flightsApiMock.bulkRefreshPreview).toHaveBeenCalledTimes(1);
    first.unmount();

    render(<BulkRefreshCard />);
    expect(await screen.findByText("settings:apiKeys.bulkRefresh.demoBlocked")).toBeInTheDocument();
    expect(flightsApiMock.bulkRefreshPreview).toHaveBeenCalledTimes(1);
  });
});
