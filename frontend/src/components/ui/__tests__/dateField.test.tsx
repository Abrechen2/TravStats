import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DateField from "../DateField";
import DateRangeField, { quickPickRange } from "../DateRangeField";
import { setClockForTests } from "../../../shared/time";
import { useSettingsStore } from "../../../store/settingsStore";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));
vi.mock("../../../hooks/useTodayZone", () => ({ useTodayZone: () => "UTC" }));

function setFormat(
  dateFormat: "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD",
  timeFormat = "24h"
): void {
  // The suite-wide settings mock (`__tests__/setup.ts`) hands out one mutable state object.
  Object.assign(useSettingsStore.getState().display, { dateFormat, timeFormat });
}

beforeEach(() => setFormat("DD.MM.YYYY"));
afterEach(() => setClockForTests(null));

describe("DateField", () => {
  it("shows the day in the profile format, not the browser's", () => {
    render(<DateField aria-label="Tag" value="2026-11-26" onChange={() => {}} />);
    expect((screen.getByLabelText("Tag") as HTMLInputElement).value).toBe("26.11.2026");
    setFormat("MM/DD/YYYY");
    render(<DateField aria-label="Day" value="2026-11-26" onChange={() => {}} />);
    expect((screen.getByLabelText("Day") as HTMLInputElement).value).toBe("11/26/2026");
  });

  it("hands the wire day to the caller for a typed date", () => {
    const onChange = vi.fn();
    render(<DateField aria-label="Tag" value="" onChange={(e) => onChange(e.target.value)} />);
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "02.10.2026" } });
    expect(onChange).toHaveBeenCalledWith("2026-10-02");
  });

  it("refuses 31.02.2026 with a field error and never reports a changed value", () => {
    const onChange = vi.fn();
    render(<DateField aria-label="Tag" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Tag");
    fireEvent.change(input, { target: { value: "31.02.2026" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("common:dateField.invalidDate");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("clears when the box is emptied", () => {
    const onChange = vi.fn();
    render(
      <DateField aria-label="Tag" value="2026-10-02" onChange={(e) => onChange(e.target.value)} />
    );
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("opens a calendar, picks a day with the mouse and closes", () => {
    setClockForTests(() => new Date("2026-11-10T12:00:00Z"));
    const onChange = vi.fn();
    render(<DateField aria-label="Tag" value="" onChange={(e) => onChange(e.target.value)} />);
    fireEvent.click(screen.getByRole("button", { name: "common:dateField.open" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(
      screen
        .getAllByRole("gridcell")
        .find((c) => c.textContent === "15" && c.getAttribute("aria-label")?.includes("November"))!
    );
    expect(onChange).toHaveBeenCalledWith("2026-11-15");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the calendar on Escape without leaking it to the page", () => {
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    render(<DateField aria-label="Tag" value="2026-11-10" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "common:dateField.open" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    window.removeEventListener("keydown", outer);
  });

  it("moves by day and week with the arrow keys", () => {
    const onChange = vi.fn();
    render(
      <DateField aria-label="Tag" value="2026-11-10" onChange={(e) => onChange(e.target.value)} />
    );
    fireEvent.click(screen.getByRole("button", { name: "common:dateField.open" }));
    const grid = screen.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute("aria-label")).toContain("18");
    fireEvent.click(focused);
    expect(onChange).toHaveBeenCalledWith("2026-11-18");
  });

  it("types a time in the 12h clock and reports 24h wire time", () => {
    setFormat("DD.MM.YYYY", "12h");
    const onChange = vi.fn();
    render(
      <DateField
        kind="time"
        aria-label="Zeit"
        value=""
        onChange={(e) => onChange(e.target.value)}
      />
    );
    fireEvent.change(screen.getByLabelText("Zeit"), { target: { value: "2:05 PM" } });
    expect(onChange).toHaveBeenCalledWith("14:05");
  });

  it("joins day and time to a date-time only when both are there", () => {
    const onChange = vi.fn();
    render(
      <DateField
        kind="datetime-local"
        aria-label="Start"
        value=""
        onChange={(e) => onChange(e.target.value)}
      />
    );
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "02.10.2026" } });
    expect(onChange).toHaveBeenLastCalledWith("");
    fireEvent.change(screen.getByLabelText("Start common:dateField.time"), {
      target: { value: "14:05" },
    });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-02T14:05");
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

  it("offers the quick picks in the calendar, in the profile zone's day", () => {
    setClockForTests(() => new Date("2026-10-09T12:00:00Z"));
    const onChange = vi.fn();
    render(<DateRangeField from="" to="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "common:dateField.open" }));
    fireEvent.click(screen.getByRole("button", { name: "common:dateField.last7" }));
    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-03", to: "2026-10-09" });
  });

  it("chooses a range with two clicks and swaps an earlier second click", () => {
    setClockForTests(() => new Date("2026-11-10T12:00:00Z"));
    const onChange = vi.fn();
    render(
      <DateRangeField from="2026-11-10" to="2026-11-10" onChange={onChange} quickPicks={[]} />
    );
    fireEvent.click(screen.getByRole("button", { name: "common:dateField.open" }));
    const cell = (n: string) =>
      screen
        .getAllByRole("gridcell")
        .find((c) => c.textContent === n && c.getAttribute("aria-label")?.includes("November"))!;
    fireEvent.click(cell("20"));
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-11-20", to: "2026-11-20" });
    fireEvent.click(cell("12"));
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-11-12", to: "2026-11-20" });
  });

  it("drags the end day along when a typed start day is past it", () => {
    const onChange = vi.fn();
    render(
      <DateRangeField from="2026-10-01" to="2026-10-05" onChange={onChange} quickPicks={[]} />
    );
    fireEvent.change(screen.getByLabelText("common:dateField.from"), {
      target: { value: "08.10.2026" },
    });
    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-08", to: "2026-10-08" });
  });

  it("never offers a day past max, quick pick included", () => {
    setClockForTests(() => new Date("2026-10-09T12:00:00Z"));
    const onChange = vi.fn();
    render(<DateRangeField from="" to="" max="2026-10-05" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "common:dateField.open" }));
    fireEvent.click(screen.getByRole("button", { name: "common:dateField.today" }));
    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-05", to: "2026-10-05" });
  });
});
