import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { bulkRefreshState } from "../bulkRefreshState";
import { quotaLine } from "../quotaCopy";

const flightsApiMock = vi.hoisted(() => ({ bulkRefreshPreview: vi.fn(), bulkRefreshRun: vi.fn() }));
vi.mock("../../../lib/api/flights", () => ({ flightsApi: flightsApiMock }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (sel: (s: { user: { id: string; providerQuotaRefused: boolean } }) => unknown) =>
    sel({ user: { id: "u", providerQuotaRefused: false } }),
}));

import BulkRefreshCard from "../BulkRefreshCard";

const t = (k: string, o?: Record<string, unknown>): string => (o ? `${k} ${JSON.stringify(o)}` : k);
const base = { demoBlocked: false, previewError: null, remaining: 0, hasProvider: true };

/**
 * forgejo#88 acceptance, 2026-10-10: with no AeroDataBox key and nothing to
 * refresh, the card said BOTH "Du benötigst einen AeroDataBox-Schlüssel" and
 * "Alle Flüge … sind aktuell". It says one thing now.
 */
describe("bulkRefreshState", () => {
  it("nothing to do wins over a missing key", () => {
    expect(bulkRefreshState({ ...base, hasProvider: false }).kind).toBe("upToDate");
  });
  it("a missing key is said only when there is something it would refresh", () => {
    expect(bulkRefreshState({ ...base, hasProvider: false, remaining: 3 })).toEqual({
      kind: "needsKey",
      pending: 3,
    });
  });
  it("ready with a key and pending flights", () => {
    expect(bulkRefreshState({ ...base, remaining: 3 })).toEqual({ kind: "ready", pending: 3 });
  });
  it("a refusal or a failure comes before everything else", () => {
    expect(bulkRefreshState({ ...base, demoBlocked: true, previewError: "x" }).kind).toBe("demo");
    expect(bulkRefreshState({ ...base, previewError: "x", remaining: 3 }).kind).toBe("error");
  });
  it("says nothing before the count is known", () => {
    expect(bulkRefreshState({ ...base, remaining: null }).kind).toBe("loading");
  });
});

describe("quotaLine", () => {
  it("says an unknown count is unknown, not '?'", () => {
    const line = quotaLine({ kind: "observed", limit: 600, remaining: null, observedAt: "" }, t);
    expect(line).toBe("settings:apiKeys.quota.unknownYet");
    expect(line).not.toContain("?");
  });
  it("gives a known count with its limit", () => {
    expect(
      quotaLine({ kind: "observed", limit: 600, remaining: 412, observedAt: "" }, t)
    ).toContain('"remaining":412,"limit":600');
  });
  it("never talks about headers", () => {
    expect(quotaLine({ kind: "not_reported", knownLimitHint: 1000 }, t)).toBe(
      'settings:apiKeys.quota.notReported settings:apiKeys.quota.staticHint {"limit":1000}'
    );
  });
});

describe("BulkRefreshCard shows one state", () => {
  beforeEach(() => flightsApiMock.bulkRefreshPreview.mockReset());

  it("no key and nothing to refresh: only 'up to date', no key warning", async () => {
    flightsApiMock.bulkRefreshPreview.mockResolvedValue({
      remaining: 0,
      hasHistoricalProvider: false,
      aerodataboxQuota: null,
    });
    render(<BulkRefreshCard />);
    expect(await screen.findByText("settings:apiKeys.bulkRefresh.allUpToDate")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
