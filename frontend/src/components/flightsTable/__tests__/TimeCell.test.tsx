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

it("suppresses only the arrival time when arr is DATE_ONLY but dep is precise", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-05-02T19:40:00Z", arrivalTime: "2026-05-03T02:45:00Z",
    depTimezone: "Europe/Berlin", arrTimezone: "Asia/Dubai",
    depTimeSemantics: "UTC", arrTimeSemantics: "DATE_ONLY",
  } as unknown as Flight} />);
  expect(screen.getByText(/21:40/)).toBeInTheDocument();      // dep time still shown
  expect(screen.queryByText(/06:45/)).not.toBeInTheDocument(); // arr time suppressed
  expect(screen.queryByText("+1")).not.toBeInTheDocument();    // no marker from a fake arrival
});

it("suppresses only the departure time when dep is DATE_ONLY but arr is precise", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-05-02T12:00:00Z", arrivalTime: "2026-05-02T15:00:00Z",
    depTimezone: "Europe/Berlin", arrTimezone: "Europe/Berlin",
    depTimeSemantics: "DATE_ONLY", arrTimeSemantics: "UTC",
  } as unknown as Flight} />);
  expect(screen.queryByText(/14:00/)).not.toBeInTheDocument(); // dep local 14:00 suppressed
  expect(screen.getByText(/17:00/)).toBeInTheDocument();       // arr local 17:00 shown
  expect(screen.queryByText("+1")).not.toBeInTheDocument();    // marker needs BOTH legs precise
});
