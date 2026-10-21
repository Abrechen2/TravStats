import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDisplayFormat } from "../../../lib/displayFormat";
import type { ItineraryItem } from "../../../types/shareLinks";
import { itineraryLine } from "../ShareLinkItineraryPreview";

/**
 * A stay known only to the month or the year carries a placeholder day
 * (`2030-06-01`). The owner's preview must not print it as "01.06.2030" — that
 * names a day nobody knows; the public page has the same rule.
 */
const settings = vi.hoisted(() => ({
  display: { language: "en", dateFormat: "DD.MM.YYYY", timeFormat: "24h" },
}));

vi.mock("../../../store/settingsStore", async () => {
  const actual = await vi.importActual<object>("../../../store/settingsStore");
  return {
    ...actual,
    useSettingsStore: Object.assign(
      (selector: (s: typeof settings) => unknown) => selector(settings),
      { getState: () => settings }
    ),
  };
});

const t = (key: string): string => key.split(".").pop() ?? key;

const stay = (
  date: string,
  precision: "day" | "month" | "year"
): Extract<ItineraryItem, { kind: "stay" }> => ({
  kind: "stay",
  name: "Hotel",
  address: null,
  city: "Lisbon",
  country: "PT",
  checkIn: { date, zone: null, precision },
  checkOut: { date, zone: null, precision },
  checkInAt: null,
  checkOutAt: null,
});

describe("share link itinerary preview — date precision", () => {
  const formatIn = (language: "de" | "en") => {
    settings.display = { ...settings.display, language };
    return renderHook(() => useDisplayFormat()).result.current;
  };

  it("writes a day-precision stay as its days", () => {
    expect(itineraryLine(stay("2030-06-01", "day"), formatIn("en"), t).detail).toBe(
      "Lisbon, PT · 01.06.2030 – 01.06.2030"
    );
  });

  it("writes a month-precision stay as the month, in the UI language", () => {
    expect(itineraryLine(stay("2030-06-01", "month"), formatIn("en"), t).detail).toBe(
      "Lisbon, PT · June 2030 – June 2030"
    );
    expect(itineraryLine(stay("2030-06-01", "month"), formatIn("de"), t).detail).toBe(
      "Lisbon, PT · Juni 2030 – Juni 2030"
    );
  });

  it("writes a year-precision stay as the year", () => {
    expect(itineraryLine(stay("2030-01-01", "year"), formatIn("en"), t).detail).toBe(
      "Lisbon, PT · 2030 – 2030"
    );
  });
});
