import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { usePhotoJourneysVisible } from "../usePhotoJourneysVisible";
import { useSettingsStore } from "../../../store/settingsStore";

/**
 * The scan's three readings are named by flights (an own, flown airport) or by
 * places (an own Place). With neither domain on, no burst can become a row, so
 * the tab would be a permanently empty section — and a reader cannot tell an
 * empty section from a broken one.
 *
 * The global setup replaces `useSettingsStore` with a static mock, so the real
 * store has to be put back before `.setState` means anything.
 */
vi.unmock("../../../store/settingsStore");

describe("usePhotoJourneysVisible", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: [] });
  });

  it("is shown for an account with flights", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    expect(renderHook(() => usePhotoJourneysVisible()).result.current).toBe(true);
  });

  it("is shown for an account with places and no flights", () => {
    useSettingsStore.setState({ enabledDomains: ["poi"] });
    expect(renderHook(() => usePhotoJourneysVisible()).result.current).toBe(true);
  });

  it("is hidden when neither is on — the tab could only ever be empty", () => {
    useSettingsStore.setState({ enabledDomains: ["cruise", "lodging"] });
    expect(renderHook(() => usePhotoJourneysVisible()).result.current).toBe(false);
  });
});
