/**
 * Pins the derived-delay arithmetic to be offset-free, matching the sibling
 * `arrivalDayOffset` logic in the same file (TimesFields.tsx), which already
 * uses `Date.UTC(...)` specifically to avoid any host-timezone dependency.
 *
 * The delay calculation used a bare `new Date(`${date}T${time}`)`, which
 * parses in the CURRENT PROCESS's local timezone. Both operands get the same
 * (possibly "wrong", i.e. not the departure airport's own) offset applied,
 * which cancels out under normal circumstances — UNTIL a DST transition of
 * the HOST's zone falls between the scheduled and the actual departure. Then
 * the two operands get parsed with DIFFERENT offsets, and the naive
 * subtraction silently bakes in that hour shift instead of the pure
 * wall-clock difference.
 *
 * This test forces the process timezone to Europe/Berlin (which has a real
 * DST transition) and picks a scheduled/actual pair straddling the
 * 2026-03-29 spring-forward (02:00 -> 03:00 CET->CEST) to make that
 * dependency observable — a fixed, offset-free implementation is completely
 * unaffected by the process's timezone, so this is deterministic regardless
 * of what timezone the CI machine itself is set to.
 *
 * A local useTranslation mock captures the `minutes` interpolation option
 * (the global test-setup mock discards options entirely) so the exact
 * derived number can be asserted, not just which key was used.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}::${JSON.stringify(options)}` : key,
    i18n: { language: "en" },
  }),
}));

import TimesFields from "../TimesFields";

const EMPTY_ACTUAL = {
  actualDepDate: "",
  actualDepTime: "",
  actualArrDate: "",
  actualArrTime: "",
};

// 2026-03-29 is the real EU spring-forward DST transition (02:00 CET jumps
// to 03:00 CEST). Scheduled departure sits just before the jump, actual
// departure just after it — the true wall-clock (pure calendar arithmetic,
// DST-oblivious) difference is 1h45m = 105 minutes. A DST-aware/local-offset
// parse of the SAME two strings, when the host process's timezone actually
// observes this transition, instead measures 45 minutes of REAL elapsed
// time (the clock skipped an hour), which is 60 minutes off from the
// wall-clock figure the fixed, offset-free arithmetic must produce.
const SCHEDULED_DEP_DATE = "2026-03-29";
const SCHEDULED_DEP_TIME = "01:30";
const ACTUAL_DEP_DATE = "2026-03-29";
const ACTUAL_DEP_TIME = "03:15";
const EXPECTED_WALL_CLOCK_DELAY_MINUTES = 105;

describe("TimesFields derived delay — DST-boundary offset independence (#200 follow-up)", () => {
  let originalTz: string | undefined;

  beforeAll(() => {
    originalTz = process.env.TZ;
    // Europe/Berlin has a real DST transition; this is what makes the
    // local-offset bug observable at all. Deliberately independent of
    // whatever timezone the host CI machine itself defaults to.
    process.env.TZ = "Europe/Berlin";
  });

  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it("derives the true wall-clock delay across a DST transition, not the DST-shifted real-elapsed-time figure", () => {
    render(
      <TimesFields
        value={{
          depDate: SCHEDULED_DEP_DATE,
          depTime: SCHEDULED_DEP_TIME,
          arrDate: SCHEDULED_DEP_DATE,
          arrTime: SCHEDULED_DEP_TIME,
        }}
        onChange={() => {}}
        actualValue={{
          ...EMPTY_ACTUAL,
          actualDepDate: ACTUAL_DEP_DATE,
          actualDepTime: ACTUAL_DEP_TIME,
        }}
        onActualChange={() => {}}
      />
    );

    const delayNode = screen.getByTestId("timesFieldsDelay");
    expect(delayNode.textContent).toContain(
      `flights:actualTimes.delayMinutes::${JSON.stringify({
        minutes: EXPECTED_WALL_CLOCK_DELAY_MINUTES,
      })}`
    );
  });
});
