import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DateField from "../DateField";
import DateRangeField, { quickPickRange } from "../DateRangeField";
import { setClockForTests } from "../../../shared/time";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../hooks/useTodayZone", () => ({ useTodayZone: () => "UTC" }));

afterEach(() => setClockForTests(null));

describe("DateField", () => {
  it("is a native date input by default and a datetime-local one on request", () => {
    const { rerender } = render(
      <DateField aria-label="Tag" value="2026-10-02" onChange={() => {}} />
    );
    expect(screen.getByLabelText("Tag").getAttribute("type")).toBe("date");
    rerender(<DateField kind="datetime-local" aria-label="Tag" value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Tag").getAttribute("type")).toBe("datetime-local");
  });

  it("hands the plain wire value to the caller, whatever the display format", () => {
    const onChange = vi.fn();
    render(<DateField aria-label="Tag" value="" onChange={(e) => onChange(e.target.value)} />);
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "2026-10-02" } });
    expect(onChange).toHaveBeenCalledWith("2026-10-02");
  });

  it("reads a year precision as a number input, not a date", () => {
    render(<DateField kind="year" aria-label="Jahr" value="2026" onChange={() => {}} />);
    expect(screen.getByLabelText("Jahr").getAttribute("type")).toBe("number");
  });
});

describe("DateRangeField", () => {
  it("computes the quick picks on the given day", () => {
    expect(quickPickRange("today", "2026-10-09")).toEqual({ from: "2026-10-09", to: "2026-10-09" });
    expect(quickPickRange("last7", "2026-10-09")).toEqual({ from: "2026-10-03", to: "2026-10-09" });
    expect(quickPickRange("thisYear", "2026-10-09")).toEqual({
      from: "2026-01-01",
      to: "2026-10-09",
    });
  });

  it("applies a quick pick in the profile zone's day, not the browser's", () => {
    setClockForTests(() => new Date("2026-10-09T12:00:00Z"));
    const onChange = vi.fn();
    render(<DateRangeField from="" to="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "dateField.last7" }));
    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-03", to: "2026-10-09" });
  });

  it("drags the end day along when the start day is moved past it", () => {
    const onChange = vi.fn();
    render(
      <DateRangeField from="2026-10-01" to="2026-10-05" onChange={onChange} quickPicks={[]} />
    );
    fireEvent.change(screen.getByLabelText("dateField.from"), { target: { value: "2026-10-08" } });
    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-08", to: "2026-10-08" });
  });

  it("never offers a day past max, quick pick included", () => {
    setClockForTests(() => new Date("2026-10-09T12:00:00Z"));
    const onChange = vi.fn();
    render(<DateRangeField from="" to="" max="2026-10-05" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "dateField.today" }));
    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-05", to: "2026-10-05" });
  });
});
