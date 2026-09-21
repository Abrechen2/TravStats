import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TourPointEditor from "../TourPointEditor";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const POINTS = [
  { id: "p1", title: "Gjendesheim", lat: 61.49, lon: 8.8 },
  { id: "p2", title: "Besseggen", lat: 61.5, lon: 8.73 },
];

describe("the standalone tour's point editor", () => {
  it("writes the whole list in one call, in the order shown", () => {
    const onSave = vi.fn();
    render(<TourPointEditor points={POINTS} saving={false} onSave={onSave} />);

    fireEvent.click(screen.getAllByLabelText("trips:tours.points.moveDown")[0]);
    fireEvent.click(screen.getByText("trips:tours.points.save"));

    // One call with the complete list — not two calls, and not a diff. The
    // endpoint replaces the list in one transaction, and a per-row save
    // would leave a half-edited tour as a state the server can be in.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].map((p: { id?: string }) => p.id)).toEqual(["p2", "p1"]);
  });

  it("keeps an existing point's id across a reorder, so its legs survive", () => {
    const onSave = vi.fn();
    render(<TourPointEditor points={POINTS} saving={false} onSave={onSave} />);

    fireEvent.click(screen.getAllByLabelText("trips:tours.points.moveUp")[1]);
    fireEvent.click(screen.getByText("trips:tours.points.save"));

    // Legs are keyed by their endpoint STOPS, never by position: an id
    // dropped here would re-create the point and take its legs with it.
    expect(onSave.mock.calls[0][0].every((p: { id?: string }) => p.id !== undefined)).toBe(true);
  });

  it("refuses to save a point with no coordinate, and says why", () => {
    const onSave = vi.fn();
    render(<TourPointEditor points={POINTS} saving={false} onSave={onSave} />);

    fireEvent.click(screen.getByText("trips:tours.points.add"));

    // A point with no coordinate produces no leg and no kilometre, and the
    // server refuses it. Meeting that after typing a whole list would be
    // one error for all of it.
    expect(screen.getByText("trips:tours.points.incomplete")).toBeInTheDocument();
    expect(screen.getByText("trips:tours.points.save")).toBeDisabled();
  });

  it("drops a removed point from the list it sends", () => {
    const onSave = vi.fn();
    render(<TourPointEditor points={POINTS} saving={false} onSave={onSave} />);

    fireEvent.click(screen.getAllByText("trips:tours.points.remove")[0]);
    fireEvent.click(screen.getByText("trips:tours.points.save"));

    expect(onSave.mock.calls[0][0]).toHaveLength(1);
    expect(onSave.mock.calls[0][0][0].id).toBe("p2");
  });
});
