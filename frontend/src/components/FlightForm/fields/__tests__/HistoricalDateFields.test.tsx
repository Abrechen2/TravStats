/**
 * HistoricalDateFields — the year/month/day pickers shared between the
 * create form and the edit modal. Pins the shape-string transitions the
 * create form's inline block established (year-only, +month, +day, clamping)
 * and the historicalDateShape discriminator that derives time semantics.
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import HistoricalDateFields, { historicalDateShape } from "../HistoricalDateFields";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

function setup(value: string) {
  const onChange = vi.fn();
  render(<HistoricalDateFields value={value} onChange={onChange} idPrefix="test" />);
  return {
    onChange,
    year: document.querySelector("#testHistoricalYear") as HTMLInputElement,
    month: document.querySelector("#testHistoricalMonth") as HTMLSelectElement,
    day: document.querySelector("#testHistoricalDay") as HTMLSelectElement,
  };
}

describe("HistoricalDateFields", () => {
  it("renders all three pickers and hydrates them from a full date", () => {
    const { year, month, day } = setup("1998-07-15");
    expect(year.value).toBe("1998");
    expect(month.value).toBe("7");
    expect(day.value).toBe("15");
  });

  it("hydrates year+month with the day picker empty but enabled", () => {
    const { year, month, day } = setup("1998-07");
    expect(year.value).toBe("1998");
    expect(month.value).toBe("7");
    expect(day.value).toBe("");
    expect(day.disabled).toBe(false);
  });

  it("disables the day picker while no month is chosen", () => {
    const { day } = setup("1998");
    expect(day.disabled).toBe(true);
  });

  it("typing a year emits year-only", () => {
    const { onChange, year } = setup("");
    fireEvent.change(year, { target: { value: "2001" } });
    expect(onChange).toHaveBeenCalledWith("2001");
  });

  it("clearing the year emits the empty string", () => {
    const { onChange, year } = setup("2001-05-20");
    fireEvent.change(year, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("picking a month emits YYYY-MM, not YYYY-MM-01", () => {
    const { onChange, month } = setup("2001");
    fireEvent.change(month, { target: { value: "5" } });
    expect(onChange).toHaveBeenCalledWith("2001-05");
  });

  it("picking a day emits the full date", () => {
    const { onChange, day } = setup("2001-05");
    fireEvent.change(day, { target: { value: "20" } });
    expect(onChange).toHaveBeenCalledWith("2001-05-20");
  });

  it("clearing the day drops back to YYYY-MM", () => {
    const { onChange, day } = setup("2001-05-20");
    fireEvent.change(day, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("2001-05");
  });

  it("clearing the month drops back to year-only, discarding the day", () => {
    const { onChange, month } = setup("2001-05-20");
    fireEvent.change(month, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("2001");
  });

  it("changing the month clamps a day that the new month does not have", () => {
    const { onChange, month } = setup("2001-01-31");
    fireEvent.change(month, { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith("2001-02-28");
  });

  it("changing the year clamps Feb 29 when leaving a leap year", () => {
    const { onChange, year } = setup("2004-02-29");
    fireEvent.change(year, { target: { value: "2005" } });
    expect(onChange).toHaveBeenCalledWith("2005-02-28");
  });
});

describe("historicalDateShape", () => {
  it("discriminates the four shapes", () => {
    expect(historicalDateShape("1998")).toBe("year");
    expect(historicalDateShape("1998-07")).toBe("year_month");
    expect(historicalDateShape("1998-07-15")).toBe("year_month_day");
    expect(historicalDateShape("")).toBe("unknown");
    expect(historicalDateShape("1998-07-15T12:00")).toBe("unknown");
  });
});
