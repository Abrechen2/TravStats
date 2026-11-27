import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Flight } from "../../types";
import { chooseYear, yearTrigger } from "../../__tests__/helpers/yearPicker";

vi.mock("../../shared/time/clock", async (orig) => ({
  ...(await orig<typeof import("../../shared/time/clock")>()),
  todayIn: () => "2024-06-01",
}));

import YearHeatmap from "../YearHeatmap";

const flightOn = (id: string, day: string): Flight =>
  ({
    id,
    status: "flown",
    times: { departure: { local: `${day}T10:00:00`, utc: `${day}T08:00:00Z` } },
  }) as unknown as Flight;

describe("YearHeatmap year picker", () => {
  it("drives the shown year through the shared picker instead of a select", () => {
    render(<YearHeatmap flights={[flightOn("a", "2023-03-03"), flightOn("b", "2024-04-04")]} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(yearTrigger("stats:heatmap.title")).toHaveTextContent("2024");
    chooseYear("stats:heatmap.title", 2023);
    expect(yearTrigger("stats:heatmap.title")).toHaveTextContent("2023");
    fireEvent.click(screen.getByRole("button", { name: "common:yearPicker.next" }));
    expect(yearTrigger("stats:heatmap.title")).toHaveTextContent("2024");
  });
});
