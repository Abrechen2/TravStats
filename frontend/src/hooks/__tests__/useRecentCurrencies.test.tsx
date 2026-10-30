import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ get: vi.fn(), warn: vi.fn() }));
vi.mock("../../lib/api/client", () => ({ api: { get: mocks.get } }));
vi.mock("../../lib/logger", () => ({ logger: { warn: mocks.warn, error: vi.fn() } }));

import { clearRecentCurrenciesCache, useRecentCurrencies } from "../useRecentCurrencies";

// forgejo#385 (RULE-36): a failed read was swallowed with `.catch(() => [])`.
describe("useRecentCurrencies", () => {
  beforeEach(() => {
    clearRecentCurrenciesCache();
    mocks.get.mockReset();
    mocks.warn.mockReset();
  });

  it("logs a failed read, offers nothing, and retries on the next mount", async () => {
    mocks.get.mockImplementationOnce(async () => {
      throw new Error("503");
    });
    const first = renderHook(() => useRecentCurrencies());
    await waitFor(() => expect(mocks.warn).toHaveBeenCalledTimes(1));
    expect(first.result.current).toEqual([]);

    mocks.get.mockResolvedValue({ data: { data: { codes: ["EUR", "USD"] } } });
    const second = renderHook(() => useRecentCurrencies());
    await waitFor(() => expect(second.result.current).toEqual(["EUR", "USD"]));
  });
});
