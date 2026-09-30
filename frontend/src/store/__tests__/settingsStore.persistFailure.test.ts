import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A switch that fails to save must not keep claiming it saved.
 *
 * Reported from the field on 2026-09-28: domains could not be turned on over a
 * weak connection. The switch flipped, the request never landed, and the next
 * page load put it back with no message — `setEnabledDomains` did not even
 * carry a `.catch`, so the rejection was unhandled and nothing anywhere said a
 * word. These tests pin the rollback and the toast for all four setters that
 * persist immediately.
 */
vi.unmock("../settingsStore");

vi.mock("../../lib/api", () => ({
  settingsApi: { update: vi.fn() },
}));

import { settingsApi } from "../../lib/api";
import { useSettingsStore } from "../settingsStore";
import { useToastStore } from "../toastStore";

const update = vi.mocked(settingsApi.update);

describe("settings that persist immediately roll back when the write fails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useSettingsStore.setState({
      enabledDomains: ["flight"],
      baseCurrency: "EUR",
      autoCreateTrips: true,
      countryThreshold: null,
    });
  });

  it("keeps the new domains when the write succeeds", async () => {
    update.mockResolvedValue({} as never);
    useSettingsStore.getState().setEnabledDomains(["flight", "cruise"]);
    await vi.waitFor(() => expect(update).toHaveBeenCalled());

    expect(useSettingsStore.getState().enabledDomains).toEqual(["flight", "cruise"]);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("puts the domains back and says so when the write fails", async () => {
    update.mockRejectedValue(new Error("Network Error"));
    useSettingsStore.getState().setEnabledDomains(["flight", "cruise"]);

    await vi.waitFor(() => expect(useSettingsStore.getState().enabledDomains).toEqual(["flight"]));
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("error");
  });

  it("puts the base currency back when the write fails", async () => {
    update.mockRejectedValue(new Error("Network Error"));
    useSettingsStore.getState().setBaseCurrency("USD");

    await vi.waitFor(() => expect(useSettingsStore.getState().baseCurrency).toBe("EUR"));
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("puts the trip-autocreate flag back when the write fails", async () => {
    update.mockRejectedValue(new Error("Network Error"));
    useSettingsStore.getState().setAutoCreateTrips(false);

    await vi.waitFor(() => expect(useSettingsStore.getState().autoCreateTrips).toBe(true));
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("puts the country threshold back when the write fails", async () => {
    update.mockRejectedValue(new Error("Network Error"));
    useSettingsStore.getState().setCountryThreshold("visited");

    await vi.waitFor(() => expect(useSettingsStore.getState().countryThreshold).toBeNull());
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});
