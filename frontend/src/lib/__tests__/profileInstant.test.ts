import { afterEach, describe, expect, it, vi } from "vitest";
import { formatInProfileZone, profileDateTime, profileWallClock } from "../profileInstant";
import { useProfileZoneStore } from "../../store/profileZoneStore";
import { useSettingsStore } from "../../store/settingsStore";

vi.unmock("../../store/settingsStore");

/**
 * A backup, a log line, an invitation: instants that belong to no place are
 * shown on the user's PROFILE clock (ADR 0002 Q1) — before, on the host's.
 * These expectations hold whatever zone the test process runs in; the
 * odd-zone CI jobs are what would catch a host-zone reading.
 */
describe("instants without a place, on the profile clock", () => {
  afterEach(() => useProfileZoneStore.setState({ status: "unknown" }));

  const inBerlin = (): void => {
    useProfileZoneStore.setState({ status: "confirmed" });
    useSettingsStore.setState((s) => ({ display: { ...s.display, timezone: "Europe/Berlin" } }));
  };

  it("shows a backup time on the profile's clock", () => {
    inBerlin();
    expect(profileDateTime("2026-09-26T22:30:05.000Z")).toBe("27.09.2026 00:30");
    expect(profileDateTime("2026-09-26T22:30:05.000Z", { seconds: true })).toBe(
      "27.09.2026 00:30:05"
    );
  });

  it("answers in UTC until the profile zone is confirmed", () => {
    useProfileZoneStore.setState({ status: "missing" });
    expect(profileWallClock("2026-09-26T22:30:05.000Z")).toBe("2026-09-26T22:30:05");
  });

  it("formats an invitation expiry on the profile clock", () => {
    inBerlin();
    expect(
      formatInProfileZone("2026-09-26T22:30:00.000Z", "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    ).toBe("Sep 27, 2026");
  });

  it("says nothing for an unusable instant", () => {
    expect(profileDateTime("nonsense")).toBeNull();
    expect(profileDateTime(null)).toBeNull();
  });
});
