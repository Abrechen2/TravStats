import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CruiseItinerary from "../../../components/Cruise/CruiseItinerary";
import type { Cruise } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const port = (id: number, name: string) => ({ id, name, city: name, country: "Italy" });

// Acceptance 2026-09-26, MSC World Europa: "Tag 8 · Auf See" stood without a
// date between "16.05." and "18.05.".
describe("CruiseItinerary — a sea day", () => {
  it("carries the date of its day of the cruise", () => {
    const cruise = {
      startDate: "2025-05-10T00:00:00.000Z",
      endDate: "2025-05-18T00:00:00.000Z",
      departurePort: null,
      arrivalPort: null,
      stops: [
        {
          id: "s7",
          dayNumber: 7,
          isAtSea: false,
          port: port(72, "Valletta"),
          date: "2025-05-16T00:00:00.000Z",
        },
        { id: "s8", dayNumber: 8, isAtSea: true, port: null, date: null, arrivalTime: null },
        {
          id: "s9",
          dayNumber: 9,
          isAtSea: false,
          port: port(136, "Barcelona"),
          date: "2025-05-18T00:00:00.000Z",
        },
      ],
    } as unknown as Cruise;
    render(<CruiseItinerary cruise={cruise} />);
    expect(screen.getByText("16.05.")).toBeInTheDocument();
    expect(screen.getByText("17.05.")).toBeInTheDocument();
    expect(screen.getByText("18.05.")).toBeInTheDocument();
  });
});
