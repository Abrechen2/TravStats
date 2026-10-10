import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const flightsApiMock = vi.hoisted(() => ({
  bulkRefreshPreview: vi.fn(),
  bulkRefreshRun: vi.fn(),
}));

vi.mock("../../../lib/api/flights", () => ({ flightsApi: flightsApiMock }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (
    selector: (s: { user: { id: string; providerQuotaRefused: boolean } }) => unknown
  ) => selector({ user: { id: "user-a", providerQuotaRefused: false } }),
}));

import BulkRefreshCard from "../BulkRefreshCard";

function axiosError(status: number | null, message: string): Error {
  return Object.assign(new Error(message), {
    response:
      status === null ? undefined : { status, data: { message: "Too many flights created" } },
  });
}

/**
 * forgejo#88 acceptance, 2026-10-10: the German settings page showed
 * "Request failed with status code 429" — axios' own English sentence — in
 * this card. A failure is said in the reader's language, by its kind.
 */
describe("BulkRefreshCard — a failed preview speaks the reader's language", () => {
  beforeEach(() => {
    flightsApiMock.bulkRefreshPreview.mockReset();
    window.sessionStorage.clear();
  });

  it("names a rate limit as one, never axios' or the server's English", async () => {
    flightsApiMock.bulkRefreshPreview.mockRejectedValue(
      axiosError(429, "Request failed with status code 429")
    );
    render(<BulkRefreshCard />);
    expect(await screen.findByText("common:saveErrors.rateLimited")).toBeInTheDocument();
    expect(screen.queryByText(/Request failed/)).toBeNull();
    expect(screen.queryByText(/Too many flights/)).toBeNull();
  });

  it("names an unreachable server as such", async () => {
    flightsApiMock.bulkRefreshPreview.mockRejectedValue(axiosError(null, "Network Error"));
    render(<BulkRefreshCard />);
    expect(await screen.findByText("common:saveErrors.network")).toBeInTheDocument();
  });

  it("falls back to its own localised sentence for anything else", async () => {
    flightsApiMock.bulkRefreshPreview.mockRejectedValue(
      axiosError(500, "Request failed with status code 500")
    );
    render(<BulkRefreshCard />);
    expect(
      await screen.findByText("settings:apiKeys.bulkRefresh.previewFailed")
    ).toBeInTheDocument();
  });
});
