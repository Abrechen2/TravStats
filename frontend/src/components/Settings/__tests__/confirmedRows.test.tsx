/**
 * Base currency and enabled domains behind the row write queue: a refused save
 * keeps the choice on its row with "Erneut versuchen" / "Verwerfen", the store
 * only ever holds what the server confirmed, and rows that write the whole
 * domain list cannot overwrite each other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
const update = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, settingsApi: { ...actual.settingsApi, update } };
});
const toast = vi.hoisted(() => vi.fn());
vi.mock("../../../store/toastStore", () => ({
  useToastStore: { getState: () => ({ addToast: toast }) },
}));
vi.unmock("../../../store/settingsStore");
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: () => false }),
}));

import UnitsSection from "../UnitsSection";
import ModuleSection from "../ModuleSection";
import { saveDomainEnabled } from "../../../store/confirmedSettings";
import { useSettingsStore } from "../../../store/settingsStore";
import { resetWriteQueue } from "../../ui/settings/writeQueue";

const units = { distanceUnit: "kilometers" as const, weightUnit: "kg" as const, currency: "EUR" };
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });
};

beforeEach(() => {
  update.mockReset().mockResolvedValue({});
  toast.mockReset();
  useSettingsStore.setState({ baseCurrency: "EUR", enabledDomains: ["flight"] });
});
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
});

describe("base currency", () => {
  const pick = (value: string): void => {
    fireEvent.change(screen.getByRole("combobox"), { target: { value } });
  };

  it("a refused save keeps the picked currency, offers a retry, and the store keeps the confirmed one", async () => {
    update.mockRejectedValueOnce(new Error("Network Error"));
    render(<UnitsSection units={units} baseCurrency="EUR" />);
    pick("USD");
    await settle();
    expect(update).toHaveBeenCalledWith({ baseCurrency: "USD" });
    expect(screen.getByRole("combobox")).toHaveValue("USD");
    expect(useSettingsStore.getState().baseCurrency).toBe("EUR");
    expect(
      screen
        .getAllByRole("alert")
        .some((a) => /settings:blocks.save.failed/.test(a.textContent ?? ""))
    ).toBe(true);
    expect(toast).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() => expect(useSettingsStore.getState().baseCurrency).toBe("USD"));
  });

  it("Verwerfen brings the confirmed currency back", async () => {
    update.mockRejectedValueOnce(new Error("Network Error"));
    render(<UnitsSection units={units} baseCurrency="EUR" />);
    pick("USD");
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.discard" }));
    expect(screen.getByRole("combobox")).toHaveValue("EUR");
  });
});

describe("enabled domains", () => {
  it("a refused switch keeps its position on the row and the confirmed list untouched", async () => {
    update.mockRejectedValueOnce(new Error("Network Error"));
    render(<ModuleSection />);
    const sw = screen.getByRole("switch", { name: /domain\.cruise/ });
    expect(sw).not.toBeChecked();
    fireEvent.click(sw);
    await settle();
    expect(update).toHaveBeenCalledWith({ enabledDomains: ["flight", "cruise"] });
    expect(sw).toBeChecked();
    expect(useSettingsStore.getState().enabledDomains).toEqual(["flight"]);
    expect(toast).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() =>
      expect(useSettingsStore.getState().enabledDomains).toEqual(["flight", "cruise"])
    );
  });

  it("two domains flipped at once both reach the server (the second builds on the first)", async () => {
    await Promise.all([saveDomainEnabled("cruise", true), saveDomainEnabled("rail", true)]);
    expect(update).toHaveBeenLastCalledWith({ enabledDomains: ["flight", "cruise", "rail"] });
    expect(useSettingsStore.getState().enabledDomains).toEqual(["flight", "cruise", "rail"]);
  });

  it("a refused first flip does not leak into the second one", async () => {
    update.mockRejectedValueOnce(new Error("503"));
    const [first, second] = await Promise.allSettled([
      saveDomainEnabled("cruise", true),
      saveDomainEnabled("rail", true),
    ]);
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("fulfilled");
    expect(useSettingsStore.getState().enabledDomains).toEqual(["flight", "rail"]);
  });
});
