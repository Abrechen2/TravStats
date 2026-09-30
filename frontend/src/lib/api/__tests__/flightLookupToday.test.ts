import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("../client", () => ({ api: { get: (...a: unknown[]) => get(...a) } }));
vi.unmock("../../../store/settingsStore");

import { flightLookupApi } from "../flightLookup";
import { julianDateToDate } from "../../airline-parsers/bcbpHelpers";
import { setClockForTests } from "../../../shared/time";
import { useProfileZoneStore } from "../../../store/profileZoneStore";
import { useSettingsStore } from "../../../store/settingsStore";

/**
 * "Today" is the user's PROFILE zone's day (ADR 0002 Q1), not the browser's.
 * The flight lookup told the server the BROWSER's zone, and the boarding-pass
 * parser picked the pass's year from the host's clock; both now ask the
 * profile zone (UTC until it is confirmed).
 */
const inKiritimati = (): void => {
  useProfileZoneStore.setState({ status: "confirmed" });
  useSettingsStore.setState((s) => ({ display: { ...s.display, timezone: "Pacific/Kiritimati" } }));
};

describe("today in the profile zone", () => {
  afterEach(() => {
    setClockForTests(null);
    useProfileZoneStore.setState({ status: "unknown" });
    get.mockReset();
  });

  it("sends the profile zone with a flight lookup", async () => {
    inKiritimati();
    get.mockResolvedValue({ data: { success: true, flights: [] } });
    await flightLookupApi.lookup("LH400", "2026-09-26");
    expect(get.mock.calls[0][1].params.tz).toBe("Pacific/Kiritimati");
  });

  it("sends UTC until the profile zone is confirmed", async () => {
    useProfileZoneStore.setState({ status: "missing" });
    get.mockResolvedValue({ data: { success: true, flights: [] } });
    await flightLookupApi.lookup("LH400", "2026-09-26");
    expect(get.mock.calls[0][1].params.tz).toBe("UTC");
  });

  it("reads a boarding pass's day of year against the profile zone's today", () => {
    // 12:00 UTC on 1 March is already 2 March in Kiritimati. Day 361
    // (27 December) is then exactly 300 days ahead — this year — where the
    // UTC day (301 days ahead) read it as LAST year's.
    // The system clock is pinned too, so a host-clock reading would see the same instant.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
    setClockForTests("2026-03-01T12:00:00.000Z");
    inKiritimati();
    expect(julianDateToDate("361")).toBe("2026-12-27");
    vi.useRealTimers();
  });
});
