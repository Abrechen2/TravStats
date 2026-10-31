import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import TourRouteNotes from "../TourRouteNotes";

// forgejo#393: TripRoute.notes reached the API and the spreadsheet, never a screen.
describe("TourRouteNotes", () => {
  it("shows the stored notes", () => {
    render(<TourRouteNotes notes={"Start at the car park\nBring water"} />);
    expect(screen.getByTestId("tour-route-notes").textContent).toBe(
      "Start at the car park\nBring water"
    );
  });

  it("draws nothing for null or blank notes", () => {
    const { container, rerender } = render(<TourRouteNotes notes={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TourRouteNotes notes={"  \n "} />);
    expect(container).toBeEmptyDOMElement();
  });
});
