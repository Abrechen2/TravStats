import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import KpiScorecard from "./KpiScorecard";
import type { ScorecardTileVM } from "./ScorecardTile";

const tiles: ScorecardTileVM[] = [
  {
    key: "flights",
    label: "Flüge",
    value: "42",
    takeaway: "letzte 12 Monate",
    points: [1, 2, 3],
    current: 42,
    previous: 30,
  },
  {
    key: "distance",
    label: "Distanz",
    value: "88.000 km",
    takeaway: "letzte 12 Monate",
    points: [3, 2, 1],
    current: 88000,
    previous: 90000,
  },
];

describe("KpiScorecard", () => {
  it("renders one tile per view-model with value, label, takeaway and a sparkline", () => {
    const { container } = render(<KpiScorecard tiles={tiles} />);
    expect(screen.getByText("Flüge")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("88.000 km")).toBeInTheDocument();
    expect(screen.getAllByText(/letzte 12 Monate/)).toHaveLength(2);
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });

  it("shows an up delta for the flights tile and a down delta for distance", () => {
    render(<KpiScorecard tiles={tiles} />);
    expect(screen.getByText(/↑/)).toBeInTheDocument();
    expect(screen.getByText(/↓/)).toBeInTheDocument();
  });
});
