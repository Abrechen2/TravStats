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

  // Review 2026-09-26, finding 7: a converted roadtrip leg read "along the
  // track, Transitous" although Transitous never traced it.
  it("says a converted roadtrip leg's distance runs along the roadtrip route", () => {
    render(
      <RailJourneyRow
        journey={{ ...base, distanceKm: 243.5, distanceSource: "roadtrip" }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/244 km \(rail:roadtripLine\)/)).toBeInTheDocument();
    expect(screen.queryByText(/rail:tracedLine/)).toBeNull();
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

// forgejo#132 item 16: the DB station code beside each name, never a guess.
describe("RailJourneyRow station codes", () => {
  it("shows each station's short code beside its name", () => {
    render(
      <RailJourneyRow
        journey={{ ...base, depStationShortCode: "FF", arrStationShortCode: "FFU" }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const codes = screen.getAllByTestId("station-short-code").map((el) => el.textContent);
    expect(codes).toEqual(["FF", "FFU"]);
  });

  it("shows no code where none is known", () => {
    render(
      <RailJourneyRow
        journey={{ ...base, depStationShortCode: "FF", arrStationShortCode: null }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getAllByTestId("station-short-code").map((el) => el.textContent)).toEqual(["FF"]);
  });
});
