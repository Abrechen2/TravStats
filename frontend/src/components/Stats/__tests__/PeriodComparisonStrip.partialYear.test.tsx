// The cruise / stay / place strip compares per-year totals the SERVER computed,
// so it cannot narrow a still-running year the way the Gesamt tab narrows its
// day-keyed adapters. What it must not do is present the comparison as
// like-for-like while it is eight months against twelve.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PeriodComparisonStrip from "../PeriodComparisonStrip";

const rows = [{ key: "stays", label: "Stays", current: 4, previous: 12 }];

beforeAll(() => {
  vi.useFakeTimers();
  // Pinned, because the component asks the real clock: without this the test
  // would assert one label in September and the other in January.
  vi.setSystemTime(new Date(2026, 8, 18));
});
afterAll(() => vi.useRealTimers());

describe("PeriodComparisonStrip under a year that is still running", () => {
  it("says it is set against the WHOLE compare year, and why", () => {
    render(<PeriodComparisonStrip year={2026} compareYear={2025} rows={rows} />);
    expect(screen.getByText("stats:yearFilter.vsFullYear")).toBeInTheDocument();
    expect(screen.getByText("stats:yearFilter.partialYearNote")).toBeInTheDocument();
  });

  it("keeps the plain label for a year that is over", () => {
    render(<PeriodComparisonStrip year={2025} compareYear={2024} rows={rows} />);
    expect(screen.getByText("stats:yearFilter.vs")).toBeInTheDocument();
    expect(screen.queryByText("stats:yearFilter.partialYearNote")).not.toBeInTheDocument();
  });
});
