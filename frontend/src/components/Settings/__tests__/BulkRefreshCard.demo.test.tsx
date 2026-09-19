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
});
