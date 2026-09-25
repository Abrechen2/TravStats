import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { CountryDetail } from "../../../types/passport";

const getCountryDetailMock = vi.fn();
vi.mock("../../../lib/api", () => ({
  statsApi: { getCountryDetail: (code: string) => getCountryDetailMock(code) },
}));

import CountryProvenance from "../CountryProvenance";

/**
 * A country raised by a roadtrip station must name the station and open the
 * roadtrip it is edited on — the owner's rule that every number names its
 * evidence and links the editable record. Two stations of one roadtrip on one
 * day share a link and a date, so both must still render.
 */
const detail: CountryDetail = {
  code: "NO",
  continent: "Europe",
  evidence: "roadtrip",
  isHome: false,
  entries: 0,
  firstYear: 2024,
  lastYear: 2024,
  airports: [],
  portCalls: 0,
  places: 0,
  lodgings: 0,
  roadtripStations: 2,
  trackDays: 0,
  anchor: null,
  timeline: [
    {
      kind: "roadtrip",
      date: "2024-07-14",
      roadtripId: "rt1",
      roadtripName: "Skandinavien",
      stationId: "st1",
      stationTitle: "Preikestolen Camping",
    },
    {
      kind: "roadtrip",
      date: "2024-07-14",
      roadtripId: "rt1",
      roadtripName: "Skandinavien",
      stationId: "st2",
      stationTitle: "Lysefjord",
    },
  ],
  timelineTruncated: false,
};

describe("CountryProvenance — roadtrip stations", () => {
  it("names each station and links its roadtrip", async () => {
    getCountryDetailMock.mockResolvedValue(detail);
    render(
      <MemoryRouter>
        <CountryProvenance code="NO" />
      </MemoryRouter>
    );

    const first = await screen.findByRole("link", { name: /Preikestolen Camping/ });
    expect(first).toHaveAttribute("href", "/roadtrips/rt1");
    expect(first.textContent).toContain("Skandinavien");
    expect(screen.getByRole("link", { name: /Lysefjord/ })).toHaveAttribute(
      "href",
      "/roadtrips/rt1"
    );
  });
});
