import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import FlightScorecardBlock from "../FlightScorecardBlock";
import EvidencePanel from "../../../evidence/EvidencePanel";
import { useEvidenceOpenStore } from "../../../evidence/evidenceOpenStore";
import { evidenceApi } from "../../../../lib/api/evidence";
import type { EvidenceResponse } from "../../../../shared/evidence";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  useEvidenceOpenStore.setState({ scope: undefined, renderedValue: undefined });
});

vi.mock("../../../../lib/api/evidence", () => ({
  evidenceApi: { get: vi.fn() },
}));

function emptyResponse(): EvidenceResponse {
  return {
    measure: {
      kind: "metric",
      key: "scorecardFlightCount",
      aggregation: "sum",
      label: { key: "evidence.metric.scorecardFlightCount" },
      unit: "flights",
      value: 0,
      scope: { period: { kind: "year", year: new Date().getUTCFullYear() } },
    },
    entries: [],
    returned: 0,
    omitted: { count: 0, contribution: 0 },
    unattributed: [],
    page: { offset: 0, limit: 100 },
  };
}

/**
 * The scorecard is the one flight surface whose scope the user picks, so it
 * is also the one that can ask evidence for a scope the endpoint rejects.
 * With the range on "year" and the page's year picker on "all years",
 * `selectedYear` is null while the tile itself is showing the CURRENT year —
 * `resolveWindow` defaults it. The request has to carry that same year;
 * `year: undefined` with `period=year` is a 400 by schema, i.e. a tile that
 * renders a number and then refuses to explain it.
 */
describe("FlightScorecardBlock — the evidence scope it opens with", () => {
  it("sends the current UTC year when the range is 'year' and no year is picked", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(emptyResponse());

    render(
      <MemoryRouter initialEntries={["/stats"]}>
        <FlightScorecardBlock
          timeseries={null}
          rangeWindow="year"
          onRangeChange={vi.fn()}
          selectedYear={null}
        />
        <EvidencePanel />
      </MemoryRouter>
    );

    const tiles = screen.getAllByRole("button", { expanded: undefined });
    const flightsTile = tiles.find((b) => b.getAttribute("aria-haspopup") === "dialog");
    expect(flightsTile).toBeDefined();
    await userEvent.click(flightsTile!);

    await waitFor(() => expect(evidenceApi.get).toHaveBeenCalled());
    expect(evidenceApi.get).toHaveBeenCalledWith(
      "metric",
      "scorecardFlightCount",
      expect.objectContaining({ period: "year", year: new Date().getUTCFullYear() })
    );
  });

  it("passes the picked year through unchanged when there is one", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(emptyResponse());

    render(
      <MemoryRouter initialEntries={["/stats"]}>
        <FlightScorecardBlock
          timeseries={null}
          rangeWindow="year"
          onRangeChange={vi.fn()}
          selectedYear={2023}
        />
        <EvidencePanel />
      </MemoryRouter>
    );

    const flightsTile = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-haspopup") === "dialog");
    await userEvent.click(flightsTile!);

    await waitFor(() => expect(evidenceApi.get).toHaveBeenCalled());
    expect(evidenceApi.get).toHaveBeenCalledWith(
      "metric",
      "scorecardFlightCount",
      expect.objectContaining({ period: "year", year: 2023 })
    );
  });
});
