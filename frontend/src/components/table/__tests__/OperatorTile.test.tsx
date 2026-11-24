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

  // UAT rc.45: a muted "~" on the monogram's colour could not be seen.
  it("draws the marker in the page's own colours, above a logo, under the explaining tooltip", () => {
    render(<OperatorTile name="Korail" domain="rail" logoUrl="/x.png" inferred />);
    const marker = screen.getByTestId("operator-inferred");
    expect(marker.style.background).toBe("var(--ts-bg)");
    expect(marker.style.color).toBe("var(--ts-text)");
    expect(marker.style.zIndex).toBe("1");
    expect(screen.getByTestId("operator-tile").getAttribute("title")).toContain(
      "common:operatorInferred"
    );
  });

  it("shows no marker for an entered operator", () => {
    render(<OperatorTile name="DB Fernverkehr" domain="rail" />);
    expect(screen.queryByTestId("operator-inferred")).toBeNull();
  });
});
