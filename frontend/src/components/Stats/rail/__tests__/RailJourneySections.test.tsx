import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import RailJourneySections from "../RailJourneySections";
import type { RailJourneyFigures } from "../../../../types/rail";

/**
 * forgejo#261 — the rail tab's journey blocks draw the server's figures, say
 * how each is counted behind a disclosure a keyboard can open, and never read
 * an unmeasured change or delay as a number.
 */
const FIGURES: RailJourneyFigures = {
  journeys: { total: 4, withTransfer: 1 },
  transfers: { count: 1, averageMinutes: 15, shortestMinutes: 15, longestMinutes: 15 },
  favouriteConnections: [
    {
      from: "Basel SBB",
      to: "Köln Hbf",
      rides: 3,
      latestRideId: "4b0c5c7e-7e53-4d8c-8d67-0b2b9e1e1a11",
    },
  ],
  newConnections: { inScope: 2, byYear: [{ year: 2025, count: 2 }] },
  punctuality: {
    byOperator: [{ label: "DB Fernverkehr", measured: 4, onTime: 1, averageMinutes: 7.5 }],
    byConnection: [],
  },
  nightTrainNights: { nights: 2, undated: 0 },
};

const visibility = { isVisible: () => true, toggle: vi.fn(), reset: vi.fn(), hiddenCount: 0 };

function draw(figures: RailJourneyFigures = FIGURES) {
  return render(
    <MemoryRouter>
      <RailJourneySections
        figures={figures}
        rides={6}
        delaysRecorded={4}
        year={null}
        accent="red"
        visibility={visibility}
      />
    </MemoryRouter>
  );
}

describe("RailJourneySections", () => {
  it("draws journeys, nights and new connections with the server's figures", () => {
    draw();
    const block = screen.getByTestId("rail-journeys");
    expect(within(block).getByText("4")).toBeInTheDocument();
    // Two nights on board and two new connections.
    expect(within(block).getAllByText("2")).toHaveLength(2);
    // The favourite links to its most recent ride.
    expect(screen.getByRole("link", { name: /Basel SBB – Köln Hbf/ })).toHaveAttribute(
      "href",
      "/rail/4b0c5c7e-7e53-4d8c-8d67-0b2b9e1e1a11"
    );
  });

  it("says no change was measured instead of drawing a 0-minute change", () => {
    draw({
      ...FIGURES,
      transfers: { count: 0, averageMinutes: null, shortestMinutes: null, longestMinutes: null },
    });
    expect(screen.getByText("rail:stats.transfersNone")).toBeInTheDocument();
    expect(screen.getAllByText("–").length).toBeGreaterThan(0);
  });

  it("shows an operator's on-time share over its measured rides, with the sample", () => {
    draw();
    expect(screen.getByText("25 %")).toBeInTheDocument();
    expect(screen.getByText("rail:stats.punctualityByConnection")).toBeInTheDocument();
    expect(screen.getAllByText("rail:stats.noPunctuality")).toHaveLength(1);
  });

  // A native <summary>: the browser opens it with Enter or Space once it has
  // focus. jsdom does not run that activation, so the test proves the two
  // halves it can see — Tab reaches the summary, and activating it opens.
  it("puts the counting help in the tab order and opens it on activation", async () => {
    draw();
    const help = screen.getByTestId("rail-journeys-help");
    expect(help).not.toHaveAttribute("open");
    const summary = within(help).getByText("stats:metricHelp.summary");
    expect(summary.tagName).toBe("SUMMARY");
    const user = userEvent.setup();
    for (let i = 0; i < 40 && document.activeElement !== summary; i += 1) await user.tab();
    expect(document.activeElement).toBe(summary);
    await user.click(summary);
    expect(help).toHaveAttribute("open");
    expect(within(help).getByText("rail:stats.help.journeys")).toBeVisible();
  });

  it("hides a block the reader switched off", () => {
    render(
      <MemoryRouter>
        <RailJourneySections
          figures={FIGURES}
          rides={6}
          delaysRecorded={4}
          year={2025}
          accent="red"
          visibility={{ ...visibility, isVisible: (key: string) => key !== "punctuality" }}
        />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("rail-punctuality")).not.toBeInTheDocument();
    expect(screen.getByTestId("rail-connections")).toBeInTheDocument();
  });
});
