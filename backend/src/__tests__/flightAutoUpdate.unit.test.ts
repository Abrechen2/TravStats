/**
 * Unit tests for pure functions in flightAutoUpdate.ts that don't need the DB.
 * Focused on the recent significance / empty-string semantics fix and the
 * zombie-flight transition logic.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockFlightUpdateMany = jest.fn();
jest.mock("../db", () => ({
  prisma: {
    flight: { updateMany: mockFlightUpdateMany },
  },
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Import after mocks
import {
  calculateChanges,
  hasSignificantChanges,
  transitionZombieFlights,
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

// ─── transitionZombieFlights ────────────────────────────────────────────────

describe("transitionZombieFlights", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("flips status=scheduled flights past arrival+6h to flown", async () => {
    mockFlightUpdateMany.mockResolvedValue({ count: 3 });

    const result = await transitionZombieFlights();

    expect(result).toBe(3);
    expect(mockFlightUpdateMany).toHaveBeenCalledTimes(1);

    const call = mockFlightUpdateMany.mock.calls[0][0] as {
      where: { status: string; arrivalTime: { not: null; lt: Date } };
      data: { status: string; lastModifiedBy: string; nextApiCheckAt: null };
    };
    expect(call.where.status).toBe("scheduled");
    expect(call.where.arrivalTime.not).toBeNull();
    expect(call.where.arrivalTime.lt).toBeInstanceOf(Date);

    // 6h cutoff: lt should be ~6h ago (allow 1 min slack for clock drift during test)
    const expectedCutoff = Date.now() - 6 * 60 * 60 * 1000;
    const actualCutoff = (call.where.arrivalTime.lt as Date).getTime();
    expect(Math.abs(actualCutoff - expectedCutoff)).toBeLessThan(60 * 1000);

    expect(call.data).toEqual({
      status: "flown",
      lastModifiedBy: "zombie_auto_flown",
      nextApiCheckAt: null,
    });
  });

  it("returns 0 when no zombie flights exist", async () => {
    mockFlightUpdateMany.mockResolvedValue({ count: 0 });

    expect(await transitionZombieFlights()).toBe(0);
  });

  it("returns 0 gracefully on DB error", async () => {
    mockFlightUpdateMany.mockRejectedValue(new Error("Connection refused"));

    expect(await transitionZombieFlights()).toBe(0);
  });
});
