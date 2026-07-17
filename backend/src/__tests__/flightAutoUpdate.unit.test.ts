/**
 * Unit tests for pure functions in flightAutoUpdate.ts that don't need the DB.
 * Focused on the recent significance / empty-string semantics fix. The
 * zombie-flight transition logic these tests used to cover was retired in
 * favor of the hourly status sweep (services/statusSweep.ts) — see
 * services/__tests__/statusSweep.test.ts for the equivalent coverage.
 */
import { describe, it, expect, jest } from "@jest/globals";

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Import after mocks
import {
  calculateChanges,
  hasSignificantChanges,
  type FlightChange,
} from "../services/flightAutoUpdate";

const BASE_SNAPSHOT = {
  airline: "Lufthansa",
  aircraft: "A320",
  gate: "A21",
  terminal: "1",
  depIata: "FRA",
  depIcao: "EDDF",
  arrIata: "LHR",
  arrIcao: "EGLL",
  departureTime: "2026-05-01T10:00:00.000Z",
  arrivalTime: "2026-05-01T12:00:00.000Z",
  status: "scheduled",
};

// ─── calculateChanges: empty-string semantics ───────────────────────────────

describe("calculateChanges empty-string handling", () => {
  it("treats \"\" → value as type=added (first fill)", () => {
    const original = { ...BASE_SNAPSHOT, gate: "" };
    const proposed = { ...BASE_SNAPSHOT, gate: "42A" };

    const changes = calculateChanges(original, proposed);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      field: "gate",
      oldValue: null,
      newValue: "42A",
      type: "added",
    });
  });

  it("treats null → value as type=added", () => {
    const original = { ...BASE_SNAPSHOT, aircraft: null };
    const proposed = { ...BASE_SNAPSHOT, aircraft: "A320neo" };

    const changes = calculateChanges(original, proposed);

    expect(changes[0]).toMatchObject({ field: "aircraft", type: "added" });
  });

  it("treats value → \"\" as type=removed", () => {
    const original = { ...BASE_SNAPSHOT, terminal: "1" };
    const proposed = { ...BASE_SNAPSHOT, terminal: "" };

    const changes = calculateChanges(original, proposed);

    expect(changes[0]).toMatchObject({ field: "terminal", type: "removed" });
  });

  it("detects value change as type=changed", () => {
    const original = { ...BASE_SNAPSHOT, gate: "A21" };
    const proposed = { ...BASE_SNAPSHOT, gate: "B07" };

    const changes = calculateChanges(original, proposed);

    expect(changes[0]).toMatchObject({
      field: "gate",
      oldValue: "A21",
      newValue: "B07",
      type: "changed",
    });
  });

  it("does not emit a change when both sides are empty", () => {
    const original = { ...BASE_SNAPSHOT, gate: "", terminal: null as unknown as string };
    const proposed = { ...BASE_SNAPSHOT, gate: "", terminal: "" };

    const changes = calculateChanges(original, proposed);
    expect(changes.filter(c => c.field === "gate" || c.field === "terminal")).toHaveLength(0);
  });
});

// ─── hasSignificantChanges ──────────────────────────────────────────────────

describe("hasSignificantChanges", () => {
  const change = (field: string, type: FlightChange["type"], oldValue: unknown = "x", newValue: unknown = "y"): FlightChange =>
    ({ field, type, oldValue: oldValue as FlightChange["oldValue"], newValue: newValue as FlightChange["newValue"] });

  it("returns false for zero changes", () => {
    expect(hasSignificantChanges([])).toBe(false);
  });

  it("returns true for any critical-field change (time/airport)", () => {
    expect(hasSignificantChanges([change("departureTime", "changed")])).toBe(true);
    expect(hasSignificantChanges([change("depIata", "changed")])).toBe(true);
    expect(hasSignificantChanges([change("arrIcao", "added", null, "EGLL")])).toBe(true);
  });

  it("returns true for a single added (first-fill) non-critical change", () => {
    // This is the H4-flighttest fix: filling a previously-empty gate
    // should not be silently dropped.
    expect(hasSignificantChanges([change("gate", "added", null, "42A")])).toBe(true);
  });

  it("returns false for a single changed (modify) non-critical change", () => {
    // A single gate A21→B07 is noise; wait for a second signal.
    expect(hasSignificantChanges([change("gate", "changed", "A21", "B07")])).toBe(false);
  });

  it("returns true for two changed non-critical fields", () => {
    expect(
      hasSignificantChanges([
        change("gate", "changed", "A21", "B07"),
        change("terminal", "changed", "1", "2"),
      ]),
    ).toBe(true);
  });
});

// ─── actualDeparture / actualArrival handling ───────────────────────────────

describe("calculateChanges actual_* time fields", () => {
  it("includes actualDeparture in the comparison set (was silently dropped before)", () => {
    const original = { ...BASE_SNAPSHOT, actualDeparture: null };
    const proposed = {
      ...BASE_SNAPSHOT,
      actualDeparture: "2026-05-01T10:07:00.000Z", // 7 min off-block delay
    };

    const changes = calculateChanges(original, proposed);

    expect(changes.find(c => c.field === "actualDeparture")).toMatchObject({
      type: "added",
      newValue: "2026-05-01T10:07:00.000Z",
    });
  });

  it("ignores sub-5-minute jitter on actualDeparture (time threshold applies)", () => {
    const original = {
      ...BASE_SNAPSHOT,
      actualDeparture: "2026-05-01T10:00:00.000Z",
    };
    const proposed = {
      ...BASE_SNAPSHOT,
      actualDeparture: "2026-05-01T10:03:00.000Z", // 3 min drift — below threshold
    };

    const changes = calculateChanges(original, proposed);
    expect(changes.find(c => c.field === "actualDeparture")).toBeUndefined();
  });

  it("includes actualArrival as critical — single change is significant", () => {
    const c: FlightChange = {
      field: "actualArrival",
      type: "added",
      oldValue: null,
      newValue: "2026-05-01T12:15:00.000Z",
    };
    expect(hasSignificantChanges([c])).toBe(true);
  });
});
