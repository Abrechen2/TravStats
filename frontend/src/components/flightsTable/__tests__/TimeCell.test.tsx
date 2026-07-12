import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TimeCell from "../TimeCell";
import type { Flight } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

const base = { id: "1", depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 } as unknown as Flight;

it("shows airport-local times and a +1 marker for an overnight flight", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-05-02T19:40:00Z", arrivalTime: "2026-05-03T02:45:00Z",
    depTimezone: "Europe/Berlin", arrTimezone: "Asia/Dubai",
  } as unknown as Flight} />);
  expect(screen.getByText(/21:40/)).toBeInTheDocument();
  expect(screen.getByText(/06:45/)).toBeInTheDocument();
  expect(screen.getByText("+1")).toBeInTheDocument();
});

it("shows date-only rows without marker for DATE_ONLY flights", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-05-02T12:00:00Z", arrivalTime: "2026-05-02T12:00:00Z",
    depTimeSemantics: "DATE_ONLY", arrTimeSemantics: "DATE_ONLY",
  } as unknown as Flight} />);
  expect(screen.queryByText(/12:00/)).not.toBeInTheDocument();
  expect(screen.queryByText("+1")).not.toBeInTheDocument();
});

it("renders an em dash when no departure time exists", () => {
  render(<TimeCell flight={base} />);
  expect(screen.getAllByText("—").length).toBeGreaterThan(0);
});
