import { describe, it, expect, beforeEach } from "vitest";
import type { JSX } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import StatsPeriodBar from "../StatsPeriodBar";
import { useStatsPeriod } from "../useStatsPeriod";
import { useStatsCompareStore } from "../../../store/statsCompareStore";

/**
 * The page composes these two exactly like this. The tests lived on the
 * overview tab until the period moved up to the page (2026-09-16); what they
 * pin did not change, only where the state is owned.
 */
function Period({ years, loading = false }: { years: number[]; loading?: boolean }): JSX.Element {
  const period = useStatsPeriod(years, loading);
  return <StatsPeriodBar years={years} period={period} />;
}

const checkbox = (): HTMLInputElement => screen.getByRole("checkbox") as HTMLInputElement;

describe("statistics period — compare persistence (issue #188)", () => {
  beforeEach(() => {
    localStorage.clear();
    useStatsCompareStore.getState().reset();
  });

  it("auto-picks comparison ON for a brand-new user with 2+ years of data", () => {
    render(<Period years={[2023, 2024]} />);
    expect(checkbox().checked).toBe(true);
    expect(useStatsCompareStore.getState().compareYear).toBe(2023);
  });

  it("selects the most recent year once data lands", () => {
    render(<Period years={[2022, 2023, 2024]} />);
    expect(screen.getByRole("button", { name: "2024" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a user turning the toggle OFF stays off after remounting", () => {
    const { unmount } = render(<Period years={[2023, 2024]} />);
    expect(checkbox().checked).toBe(true);

    fireEvent.click(checkbox());
    expect(checkbox().checked).toBe(false);
    unmount();
    cleanup();

    // Remount — simulates navigating away from /stats and back.
    render(<Period years={[2023, 2024]} />);
    expect(checkbox().checked).toBe(false);
  });

  it("a user-chosen comparison year stays selected after remounting", () => {
    const { unmount } = render(<Period years={[2021, 2022, 2023, 2024]} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2021" } });
    expect(select.value).toBe("2021");
    unmount();
    cleanup();

    render(<Period years={[2021, 2022, 2023, 2024]} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("2021");
  });

  it("turns comparison off (no crash) when a persisted compare year is no longer available", () => {
    // A richer dataset once had 2023; this one only has 2024.
    useStatsCompareStore.getState().setCompare(true, 2023);

    expect(() => render(<Period years={[2024]} />)).not.toThrow();

    // No other year exists to compare against.
    expect(checkbox().checked).toBe(false);
    expect(useStatsCompareStore.getState().compareYear).toBeNull();
  });

  it("does not render a comparison on a brand-new install with only one year of data", () => {
    render(<Period years={[2024]} />);
    expect(checkbox().checked).toBe(false);
    expect(useStatsCompareStore.getState().compareYear).toBeNull();
  });

  it("does not wipe a persisted preference while stats are still loading (regression)", () => {
    // A returning user; the stats have not resolved, so `years` is still `[]`.
    useStatsCompareStore.getState().setCompare(true, 2021);

    const { rerender } = render(<Period years={[]} loading />);

    // The stale-year resolution must not have run at all.
    expect(useStatsCompareStore.getState().compareEnabled).toBe(true);
    expect(useStatsCompareStore.getState().compareYear).toBe(2021);

    // Data arrives; 2021 is genuinely among the years.
    rerender(<Period years={[2021, 2022, 2023, 2024]} />);

    expect(useStatsCompareStore.getState().compareEnabled).toBe(true);
    expect(useStatsCompareStore.getState().compareYear).toBe(2021);
    expect(checkbox().checked).toBe(true);
  });

  it("still falls back to the nearest available year once data has genuinely loaded", () => {
    useStatsCompareStore.getState().setCompare(true, 2021);

    render(<Period years={[2023, 2024]} />);

    expect(useStatsCompareStore.getState().compareYear).toBe(2023);
    expect(useStatsCompareStore.getState().compareEnabled).toBe(true);
    expect(checkbox().checked).toBe(true);
  });

  it("disables comparison once loaded when only a single year of data truly exists", () => {
    useStatsCompareStore.getState().setCompare(true, 2021);

    render(<Period years={[2024]} />);

    expect(useStatsCompareStore.getState().compareEnabled).toBe(false);
    expect(useStatsCompareStore.getState().compareYear).toBeNull();
    expect(checkbox().checked).toBe(false);
  });
});
