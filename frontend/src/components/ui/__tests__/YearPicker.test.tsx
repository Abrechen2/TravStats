import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import YearPicker, { type YearValue } from "../YearPicker";

const YEARS = [
  { year: 2023, count: 2 },
  { year: 2024, count: 1 },
  { year: 2026, count: 9 },
];

function Harness({
  initial,
  allowAll = true,
  spy,
}: {
  initial: YearValue;
  allowAll?: boolean;
  spy?: (v: YearValue) => void;
}) {
  const [v, setV] = useState<YearValue>(initial);
  return (
    <YearPicker
      years={YEARS}
      value={v}
      allowAll={allowAll}
      formatCount={(n) => `${n} Reisen`}
      onChange={(next) => {
        spy?.(next);
        setV(next);
      }}
    />
  );
}

const prev = () =>
  screen.getByRole("button", { name: /yearPicker\.previous|Vorheriges Jahr|Previous year/ });
const next = () => screen.getByRole("button", { name: /yearPicker\.next|Nächstes Jahr|Next year/ });
const trigger = () => screen.getAllByRole("button")[1];

describe("YearPicker", () => {
  it("steps to the previous and next year WITH data, skipping the empty 2025", () => {
    render(<Harness initial={2026} />);
    fireEvent.click(prev());
    expect(trigger().textContent).toBe("2024");
    fireEvent.click(next());
    expect(trigger().textContent).toBe("2026");
  });

  it("disables the newest end's next arrow", () => {
    render(<Harness initial={2026} />);
    expect((next() as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables the oldest end's previous arrow", () => {
    render(<Harness initial={2023} />);
    expect((prev() as HTMLButtonElement).disabled).toBe(true);
  });

  it("steps from 'all' to the newest year, with no later year to go to", () => {
    const spy = vi.fn();
    render(<Harness initial="all" spy={spy} />);
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(prev());
    expect(spy).toHaveBeenCalledWith(2026);
  });

  it("opens a grid with counts, marks the selection and closes on choosing", () => {
    const spy = vi.fn();
    render(<Harness initial={2024} spy={spy} />);
    fireEvent.click(trigger());
    expect(screen.getByText("9 Reisen")).toBeTruthy();
    const cell = screen.getByRole("button", { name: /^2024/, pressed: true });
    expect(cell).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^2026/ }));
    expect(spy).toHaveBeenCalledWith(2026);
    expect(screen.queryByText("9 Reisen")).toBeNull();
  });

  it("offers the 'all years' option on top and reports it", () => {
    const spy = vi.fn();
    render(<Harness initial={2024} spy={spy} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: /yearPicker\.all|Alle Jahre|All years/ }));
    expect(spy).toHaveBeenCalledWith("all");
  });

  it("hides 'all years' when the page always needs a year", () => {
    render(<Harness initial={2024} allowAll={false} />);
    fireEvent.click(trigger());
    expect(
      screen.queryByRole("button", { name: /yearPicker\.all|Alle Jahre|All years/ })
    ).toBeNull();
  });

  it("closes on Escape and on an outside click", () => {
    render(
      <div>
        <span data-testid="outside">x</span>
        <Harness initial={2024} />
      </div>
    );
    fireEvent.click(trigger());
    expect(screen.queryByText("9 Reisen")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("9 Reisen")).toBeNull();
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByText("9 Reisen")).toBeNull();
  });

  it("swallows Escape so an enclosing dialog stays open, and returns focus to the pill", () => {
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    render(<Harness initial={2024} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    document.removeEventListener("keydown", outer);
    expect(outer).not.toHaveBeenCalled();
    expect(screen.queryByText("9 Reisen")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("moves focus with the arrow keys inside the grid", () => {
    render(<Harness initial={2026} />);
    fireEvent.click(trigger());
    const cell2026 = screen.getByRole("button", { name: /^2026/ });
    expect(document.activeElement).toBe(cell2026);
    fireEvent.keyDown(cell2026, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^2024/ }));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cell2026);
    fireEvent.keyDown(cell2026, { key: "ArrowUp" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /yearPicker\.all|Alle Jahre|All years/ })
    );
  });

  it("shows plain years when no counts are given", () => {
    render(<YearPicker years={[{ year: 2024 }]} value={2024} onChange={() => undefined} />);
    fireEvent.click(trigger());
    expect(screen.queryByText(/Reisen/)).toBeNull();
  });
});
