import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.unmock("../../store/settingsStore");

import { usePlacesAccess, usePlacesVisible } from "../usePlacesVisible";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * The bug this pins was found by driving a browser, not by a test: a hard
 * navigation to /places bounced to the dashboard, while clicking through to it
 * from inside the app worked.
 *
 * Cause: `betaFeaturesEnabled` is instance state and is deliberately NOT
 * persisted to localStorage, so it is `null` for one request on every cold
 * load. `enabledDomains` IS persisted, which is why the other domains' routes
 * survived a refresh and this one did not. A boolean guard read the unknown
 * flag as "no" and redirected, so bookmarking the page, reloading it, or
 * opening a place link in a new tab all threw the user to the dashboard.
 */
describe("usePlacesAccess: pending is not denied", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      enabledDomains: ["flight", "cruise", "lodging", "poi"],
      betaFeaturesEnabled: null,
    });
  });

  it("reports PENDING while the flag has not loaded — never denied", () => {
    const { result } = renderHook(() => usePlacesAccess());
    expect(result.current).toBe("pending");
  });

  it("reports allowed once the flag arrives on", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    const { result } = renderHook(() => usePlacesAccess());
    expect(result.current).toBe("allowed");
  });

  it("reports denied when the flag is off", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    const { result } = renderHook(() => usePlacesAccess());
    expect(result.current).toBe("denied");
  });

  it("reports denied when the user has switched the domain off", () => {
    useSettingsStore.setState({
      betaFeaturesEnabled: true,
      enabledDomains: ["flight"],
    });
    const { result } = renderHook(() => usePlacesAccess());
    expect(result.current).toBe("denied");
  });

  it("usePlacesVisible still fails CLOSED while pending", () => {
    // Chrome (nav entries, the dashboard tab) must not flash into view and
    // then vanish, so the boolean form treats unknown as hidden. Only the
    // ROUTE waits — see the hook's own comment for why the two differ.
    const { result } = renderHook(() => usePlacesVisible());
    expect(result.current).toBe(false);
  });
});
