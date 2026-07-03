import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CanonicalTimeSeries from "./CanonicalTimeSeries";

// recharts ResponsiveContainer needs a size; stub it to a fixed box.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div style={{ width: 600, height: 300 }}>{children}</div>
  ) };
});

describe("CanonicalTimeSeries", () => {
  it("renders the title", () => {
    render(<CanonicalTimeSeries title="Flüge pro Monat" series={[{ period: "2025-01", count: 3, distanceKm: 0, durationMin: 0 }]} />);
    expect(screen.getByText("Flüge pro Monat")).toBeInTheDocument();
  });

  it("renders an empty-state note when the series is all zeros", () => {
    render(<CanonicalTimeSeries title="Flüge pro Monat" series={[{ period: "2025-01", count: 0, distanceKm: 0, durationMin: 0 }]} />);
    expect(screen.getByText(/stats:timeRange.noData|keine|no data/i)).toBeInTheDocument();
  });
});
