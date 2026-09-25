import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

import { RailJourneyRow } from "../RailJourneyRow";
import { RAIL_JOURNEY_FIXTURE } from "./railJourneyFixture";

/** The row links to its detail page, so it renders inside a router. */
const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const base = RAIL_JOURNEY_FIXTURE;

describe("RailJourneyRow distance label", () => {
  it("says a distance runs along the traced line", () => {
    render(<RailJourneyRow journey={base} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/88 km \(rail:tracedLine\)/)).toBeInTheDocument();
  });

  it("still says a measured distance is a straight line", () => {
    render(
      <RailJourneyRow
        journey={{
          ...base,
          distanceSource: "great_circle",
          geometry: null,
          geometrySource: "straight",
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/88 km \(rail:straightLine\)/)).toBeInTheDocument();
  });
});

describe("RailJourneyRow link", () => {
  it("opens the journey's detail page from its stations", () => {
    render(<RailJourneyRow journey={base} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Frankfurt → Fulda" })).toHaveAttribute(
      "href",
      "/rail/j1"
    );
  });
});
