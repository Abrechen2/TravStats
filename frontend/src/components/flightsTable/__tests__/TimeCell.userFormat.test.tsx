import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import TimeCell from "../TimeCell";
import type { Flight } from "../../../types";

/**
 * The flight table reads the user's date and clock format (tester report,
 * 2026-09-17: "TT.MM.JJJJ" and "12h" were set, the table showed its own
 * "Fr. 02.10.2026" and 14:05 regardless). The setting here is the opposite of
 * the suite's default on both axes, so the test cannot pass on the default.
 */
vi.mock("../../../store/settingsStore", async () => {
  const actual = await vi.importActual<object>("../../../store/settingsStore");
  const state = {
    display: { language: "en", dateFormat: "YYYY-MM-DD", timeFormat: "12h" },
  };
  return {
    ...actual,
    useSettingsStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
      getState: () => state,
    }),
  };
});

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" }, ready: true }),
}));

it("writes the date and the clock the way the user chose", () => {
  render(
    <TimeCell
      flight={
        {
          id: "1",
          depLat: 0,
          depLon: 0,
          arrLat: 0,
          arrLon: 0,
          departureTime: "2026-10-02T12:05:00Z",
          arrivalTime: "2026-10-02T14:40:00Z",
          depTimezone: "UTC",
          arrTimezone: "UTC",
        } as unknown as Flight
      }
    />
  );
  expect(screen.getAllByText("Fri 2026-10-02")).toHaveLength(2);
  expect(screen.getByText("12:05 PM")).toBeInTheDocument();
  expect(screen.getByText("2:40 PM")).toBeInTheDocument();
});
