import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TimeRangeControl from "./TimeRangeControl";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("TimeRangeControl", () => {
  it("renders the three range options", () => {
    render(<TimeRangeControl value="rolling12m" onChange={() => {}} />);
    expect(screen.getByText("stats:timeRange.rolling12m")).toBeInTheDocument();
    expect(screen.getByText("stats:timeRange.year")).toBeInTheDocument();
    expect(screen.getByText("stats:timeRange.all")).toBeInTheDocument();
  });

  it("emits the selected window on click", () => {
    const onChange = vi.fn();
    render(<TimeRangeControl value="rolling12m" onChange={onChange} />);
    fireEvent.click(screen.getByText("stats:timeRange.all"));
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("marks the active option as pressed", () => {
    render(<TimeRangeControl value="year" onChange={() => {}} />);
    expect(screen.getByText("stats:timeRange.year").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
