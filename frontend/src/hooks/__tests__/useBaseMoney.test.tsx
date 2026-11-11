import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../lib/api/client", () => ({ api: { get: mocks.get } }));

vi.unmock("../../store/settingsStore");

import { useBaseMoney } from "../useBaseMoney";
import { toDisplay } from "../../lib/displayCurrency";
import { useDisplayRateStore } from "../../lib/displayCurrency";
import { useSettingsStore } from "../../store/settingsStore";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";

const setCurrencies = (base: string, display: string | null): void => {
  useSettingsStore.setState({ baseCurrency: base });
  useSuggestionSwitchesStore.setState({ displayCurrency: display });
};

describe("a base-currency total in the display currency", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    useDisplayRateStore.setState({ known: null, asked: [] });
  });

  it("is written in the display currency once the server's rate is known", async () => {
    setCurrencies("EUR", "USD");
    mocks.get.mockResolvedValue({ data: { data: { base: "EUR", display: "USD", rate: 2 } } });
    const { result } = renderHook(() => useBaseMoney());
    // Until the rate arrives the base amount stays in the base currency.
    expect(result.current(100, { language: "en" })).toContain("€");
    await waitFor(() => expect(result.current.currency).toBe("USD"));
    expect(result.current(100, { language: "en" })).toBe("$200");
  });

  it("shows the base amount with its own currency, never a guessed number, when no rate exists", async () => {
    setCurrencies("EUR", "JPY");
    mocks.get.mockResolvedValue({ data: { data: { base: "EUR", display: "JPY", rate: null } } });
    const { result } = renderHook(() => useBaseMoney());
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(result.current.currency).toBe("EUR");
    expect(result.current(100, { language: "en" })).toBe("€100");
  });

  it("does not ask the server when display equals base", () => {
    setCurrencies("EUR", "EUR");
    renderHook(() => useBaseMoney());
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("ignores a rate fetched for another pair", () => {
    expect(toDisplay(10, "EUR", "USD", { pair: "EUR>GBP", rate: 3 })).toEqual({
      value: 10,
      currency: "EUR",
    });
  });
});
