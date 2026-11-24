import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, render, screen } from "@testing-library/react";

import { LinkedMonthChip, useLinkedMonth } from "./LinkedMonth";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));

const at = (search: string): void => window.history.replaceState({}, "", `/rail${search}`);

describe("a month named by a year card's link", () => {
  beforeEach(() => at(""));

  it("applies while the list shows that year, and is dropped when another year is picked", () => {
    at("?year=2024&month=3");
    const { result, rerender } = renderHook(({ y }) => useLinkedMonth(y), {
      initialProps: { y: 2024 as number | "all" },
    });
    expect(result.current.month).toBe(3);
    rerender({ y: 2023 });
    expect(result.current.month).toBeNull();
    rerender({ y: "all" });
    expect(result.current.month).toBeNull();
  });

  it("needs both a year and a month in the URL; clear removes it", () => {
    at("?month=3");
    expect(renderHook(() => useLinkedMonth(2024)).result.current.month).toBeNull();
    at("?year=2024&month=3");
    const { result } = renderHook(() => useLinkedMonth(2024));
    act(() => result.current.clear());
    expect(result.current.month).toBeNull();
  });

  it("is named on the page: a chip with a way to clear it, nothing without a month", () => {
    const onClear = vi.fn();
    const { rerender } = render(<LinkedMonthChip month={3} year={2024} onClear={onClear} />);
    expect(screen.getByTestId("linked-month-chip")).toBeTruthy();
    screen.getByText("stats:years.linkedMonthClear").click();
    expect(onClear).toHaveBeenCalled();
    rerender(<LinkedMonthChip month={null} year={2024} onClear={onClear} />);
    expect(screen.queryByTestId("linked-month-chip")).toBeNull();
  });
});
