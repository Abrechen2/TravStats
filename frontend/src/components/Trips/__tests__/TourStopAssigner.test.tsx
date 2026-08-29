import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TourStopAssigner from "../TourStopAssigner";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const STOPS = [
  { id: "a", title: "Kristiansand", lat: 58.15, lon: 8.0, routeOrderIdx: 0 },
  { id: "b", title: "Bergen", lat: 60.39, lon: 5.32, routeOrderIdx: 1 },
  { id: "c", title: "Restaurant", lat: null, lon: null, routeOrderIdx: null },
];

describe("TourStopAssigner", () => {
  it("sends the remaining ordered ids when a stop is switched off", () => {
    const onChange = vi.fn();
    render(<TourStopAssigner stops={STOPS} onChange={onChange} />);

    fireEvent.click(screen.getByRole("switch", { name: /Bergen/ }));
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });

  it("disables the switch for a stop with no coordinate and says why", () => {
    render(<TourStopAssigner stops={STOPS} onChange={vi.fn()} />);
    const sw = screen.getByRole("switch", { name: /Restaurant/ });
    expect(sw).toBeDisabled();
    expect(screen.getByText("trips:tours.needsCoordinate")).toBeInTheDocument();
  });

  it("adds a stop at the end when switched on", () => {
    const onChange = vi.fn();
    const stops = [...STOPS.slice(0, 2), { ...STOPS[2], lat: 1, lon: 1 }];
    render(<TourStopAssigner stops={stops} onChange={onChange} />);

    fireEvent.click(screen.getByRole("switch", { name: /Restaurant/ }));
    expect(onChange).toHaveBeenCalledWith(["a", "b", "c"]);
  });
});
