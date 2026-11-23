import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OperatorTile, rentalProviderLogoUrl } from "../OperatorTile";

describe("OperatorTile", () => {
  it("draws the monogram, never an empty box, for a provider whose logo 404s", () => {
    render(
      <OperatorTile
        name="Local RV Hire"
        domain="rental"
        logoUrl={rentalProviderLogoUrl("Local RV Hire")}
      />
    );
    fireEvent.error(screen.getByTestId("operator-logo"));
    expect(screen.queryByTestId("operator-logo")).toBeNull();
    expect(screen.getByText("LR")).toBeInTheDocument();
  });

  it("marks an inferred operator and says so in the tooltip", () => {
    render(<OperatorTile name="DB Fernverkehr" domain="rail" inferred />);
    expect(screen.getByTestId("operator-inferred")).toBeInTheDocument();
    expect(screen.getByTestId("operator-tile").getAttribute("title")).toMatch(/DB Fernverkehr/);
  });

  it("shows no marker for an entered operator", () => {
    render(<OperatorTile name="DB Fernverkehr" domain="rail" />);
    expect(screen.queryByTestId("operator-inferred")).toBeNull();
  });
});
