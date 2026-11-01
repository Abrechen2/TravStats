import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const bulk = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api/flightLookup", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api/flightLookup")>(
    "../../lib/api/flightLookup"
  );
  return { ...actual, flightLookupApi: { bulk } };
});

import { PreviewModal } from "./PreviewModal";
import type { PreviewRowEnriched } from "../../lib/api/import";

function row(i: number, over: Partial<PreviewRowEnriched> = {}): PreviewRowEnriched {
  return {
    date: "2024-01-15",
    fromIata: "FRA",
    toIata: "JFK",
    flightNumber: `LH${400 + i}`,
    source: "fr24",
    sourceRowIndex: i,
    depUtc: "2024-01-15T10:00:00.000Z",
    arrUtc: "2024-01-15T18:25:00.000Z",
    arrivalLocalCorrected: "2024-01-15T13:25:00",
    depTimezone: "Europe/Berlin",
    arrTimezone: "America/New_York",
    depLat: 50,
    depLon: 8,
    arrLat: 40,
    arrLon: -73,
    flightNumberNormalised: `LH${400 + i}`,
    statusDefault: "flown",
    flags: [],
    dedupeHint: "none",
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("PreviewModal › check with the flight-data provider (forgejo#407)", () => {
  it("asks the bulk route with each row's own day and prints each row's own answer", async () => {
    bulk.mockResolvedValue([
      { index: 0, flightNumber: "LH400", success: true, flights: [{}] },
      {
        index: 1,
        flightNumber: "LH401",
        success: false,
        error: "LOOKUP_PROVIDER_FAILED",
        providerFailures: [{ provider: "airlabs", outcome: "quota" }],
      },
      { index: 2, flightNumber: "LH402", success: true, flights: [] },
    ]);
    render(
      <PreviewModal
        rows={[row(0), row(1, { date: "2024-02-01" }), row(2)]}
        summary={{ ok: 3, problems: 0, duplicates: 0, unresolvable: 0 }}
        onCommit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /preview\.lookup\.action/ }));
    const outcomes = await screen.findAllByTestId("preview-lookup-outcome");
    expect(outcomes).toHaveLength(3);
    expect(outcomes[0]).toHaveTextContent("flights:lookup.found");
    expect(outcomes[1]).toHaveTextContent("flights:lookup.reason.providers");
    expect(outcomes[1]).toHaveTextContent("errors:providerFailure.quota");
    expect(outcomes[2]).toHaveTextContent("flights:lookup.empty");
    expect(bulk).toHaveBeenCalledWith([
      { flightNumber: "LH400", date: "2024-01-15" },
      { flightNumber: "LH401", date: "2024-02-01" },
      { flightNumber: "LH402", date: "2024-01-15" },
    ]);
  });

  it("says a refused call per row instead of leaving the rows silent", async () => {
    bulk.mockRejectedValue(
      Object.assign(new Error("x"), { isAxiosError: true, response: { status: 429, data: {} } })
    );
    render(
      <PreviewModal
        rows={[row(0)]}
        summary={{ ok: 1, problems: 0, duplicates: 0, unresolvable: 0 }}
        onCommit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /preview\.lookup\.action/ }));
    expect(await screen.findByTestId("preview-lookup-outcome")).toHaveTextContent(
      "flights:lookup.reason.rateLimited"
    );
  });
});
