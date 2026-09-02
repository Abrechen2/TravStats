import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { CountryDetail, PassportCountry } from "../../../types/passport";

const getCountryDetailMock = vi.fn();
vi.mock("../../../lib/api", () => ({
  statsApi: { getCountryDetail: (code: string) => getCountryDetailMock(code) },
}));

import CountryTable from "../CountryTable";

/**
 * What the country list has to survive.
 *
 * Each of these is a bug the rework was written to end, not a rendering
 * preference: a connection country that disappeared, a `0 h` printed where
 * nothing was measured, and a headline nobody could reconcile with the list.
 */

const country = (over: Partial<PassportCountry>): PassportCountry => ({
  code: "DE",
  continent: "Europe",
  entries: 4,
  firstYear: 2019,
  lastYear: 2024,
  airports: ["MUC", "FRA"],
  isHome: false,
  isNew: false,
  evidence: "flight",
  tier: "visited",
  kinds: ["flight"],
  hasUndatedEvidence: false,
  daysPresent: 6,
  groundTime: { state: "measured", minutes: 84 },
  counted: true,
  ...over,
});

const emptyDetail = (code: string): CountryDetail => ({
  code,
  continent: "Europe",
  evidence: "flight",
  isHome: false,
  entries: 0,
  firstYear: null,
  lastYear: null,
  airports: [],
  portCalls: 0,
  places: 0,
  lodgings: 0,
  anchor: null,
  timeline: [],
  timelineTruncated: false,
});

const renderTable = (countries: PassportCountry[]): void => {
  render(
    <MemoryRouter>
      <CountryTable countries={countries} locale="de-DE" />
    </MemoryRouter>
  );
};

describe("CountryTable — a country that does not count is greyed, not hidden", () => {
  beforeEach(() => {
    getCountryDetailMock.mockReset();
    getCountryDetailMock.mockImplementation((code: string) => Promise.resolve(emptyDetail(code)));
  });

  it("keeps an uncounted connection country in the list and marks it as not counted", () => {
    renderTable([
      country({ code: "DE" }),
      country({ code: "ET", tier: "transit", counted: false, entries: 2, airports: ["ADD"] }),
    ]);

    // The row is THERE. A tier is inferred from records and records are
    // incomplete — Ethiopia shows 4.7 h of ground time here and three
    // GPS-measured days in an independent tracker. Removing the row would
    // remove the only place a reader could notice that.
    expect(screen.getByText("ET")).toBeInTheDocument();
    expect(screen.getByTestId("tier-transit")).toBeInTheDocument();
    expect(screen.getByText("passport:countries.notCounted")).toBeInTheDocument();

    const rows = screen.getAllByRole("row");
    const uncounted = rows.filter((r) => r.getAttribute("data-counted") === "false");
    expect(uncounted).toHaveLength(1);
    expect(within(uncounted[0]).getByText("ET")).toBeInTheDocument();
  });

  it("says so when a country's evidence carries no date", () => {
    renderTable([
      country({
        code: "SI",
        kinds: ["lodging"],
        evidence: "lodging",
        tier: "slept",
        hasUndatedEvidence: true,
        firstYear: null,
        lastYear: null,
        entries: 0,
        airports: [],
      }),
    ]);

    expect(screen.getByText("passport:countries.undated")).toBeInTheDocument();
  });

  it("shows a lodging-only country as not-applicable, never as a zero", () => {
    renderTable([
      country({
        code: "CZ",
        kinds: ["lodging"],
        evidence: "lodging",
        tier: "slept",
        entries: 0,
        airports: [],
        firstYear: null,
        lastYear: null,
        hasUndatedEvidence: true,
        // Three nights recorded, so the days figure is real; the ground time is
        // not merely unmeasured but inapplicable — a house bounds no departure.
        daysPresent: 3,
        groundTime: { state: "notApplicable" },
      }),
    ]);

    const row = screen.getAllByRole("row").find((r) => r.getAttribute("data-counted") !== null);
    expect(row).toBeDefined();
    // `Abstention is a result`: no flight, no airport, no dated record and no
    // measurable ground time means four dashes, and NOT a "0" anywhere that
    // would read as a measured nothing.
    expect(within(row as HTMLElement).queryByText("0")).not.toBeInTheDocument();
    expect(within(row as HTMLElement).getAllByText("passport:value.dash")).toHaveLength(4);
    expect(
      within(row as HTMLElement).getByTitle("passport:value.notApplicableEntries")
    ).toBeInTheDocument();
    expect(
      within(row as HTMLElement).getByTitle("passport:value.unknownPeriod")
    ).toBeInTheDocument();
  });

  it("still shows measured flight figures where they exist", () => {
    renderTable([country({ code: "DE", entries: 7, airports: ["MUC"] })]);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("MUC")).toBeInTheDocument();
    expect(screen.queryByTitle("passport:value.notApplicableEntries")).not.toBeInTheDocument();
  });

  it("offers no filter for a tier no record can carry", () => {
    renderTable([country({ code: "EE", tier: "transit", counted: false })]);
    // `transited` (crossed by road) needs GPS tracks that do not exist yet. A
    // control that always returns nothing reads as a defect, so there is none.
    expect(screen.queryByTestId("tier-transited")).not.toBeInTheDocument();
    expect(screen.queryByText("passport:tiers.transited")).not.toBeInTheDocument();
  });
});

/**
 * The two figures of spec §3.4b, and the three answers one of them has.
 *
 * The union exists so an illegal state cannot be written; these tests exist so
 * a legal state cannot be rendered as the wrong one. Every case below is a way
 * the screen could lie while the types stayed green.
 */
describe("CountryTable — ground time has three states, and they read differently", () => {
  beforeEach(() => {
    getCountryDetailMock.mockReset();
    getCountryDetailMock.mockImplementation((code: string) => Promise.resolve(emptyDetail(code)));
  });

  it("renders a measured spell as a formatted duration, not a bucket", () => {
    renderTable([country({ code: "FR", groundTime: { state: "measured", minutes: 1500 } })]);

    // 25 h — the country §3.4b measured on the far side of the gap. Shown raw,
    // because fixed classes would leave the middle bins empty and hide the gap.
    expect(screen.getByTestId("ground-measured")).toHaveTextContent("25h");
    expect(screen.queryByTestId("ground-unknown")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ground-notApplicable")).not.toBeInTheDocument();
  });

  it("keeps unknown and not-applicable visibly apart, because only one is actionable", () => {
    renderTable([
      // A flight touched Ethiopia but no second one bounds the stay: the reader
      // can record the return leg.
      country({ code: "ET", kinds: ["flight"], groundTime: { state: "unknown" } }),
      // No flight touched Slovenia at all: a house bounds no departure, so
      // there is nothing to add.
      country({
        code: "SI",
        kinds: ["lodging"],
        evidence: "lodging",
        tier: "slept",
        entries: 0,
        airports: [],
        groundTime: { state: "notApplicable" },
      }),
    ]);

    const unknown = screen.getByTestId("ground-unknown");
    const notApplicable = screen.getByTestId("ground-notApplicable");

    // Different text, not merely a different tooltip on the same dash: sharing
    // one dash would throw away the half a reader can do something about.
    expect(unknown).toHaveTextContent("passport:ground.unknown");
    expect(notApplicable).toHaveTextContent("passport:value.dash");
    expect(unknown.textContent).not.toEqual(notApplicable.textContent);

    // And each names its own reason, one of which is an instruction.
    expect(unknown).toHaveAttribute("title", "passport:ground.unknownExplained");
    expect(notApplicable).toHaveAttribute("title", "passport:ground.notApplicableExplained");
  });

  it("renders a measured zero AS a measured zero, never as a dash", () => {
    // Two clocks were read and they agreed. That is a measurement, and the ban
    // on zero is a ban on zero standing in for the unknown — not on this.
    renderTable([country({ code: "QA", groundTime: { state: "measured", minutes: 0 } })]);

    const cell = screen.getByTestId("ground-measured");
    expect(cell).toHaveTextContent("0min");
    expect(cell).not.toHaveTextContent("passport:value.dash");
    expect(screen.queryByTestId("ground-unknown")).not.toBeInTheDocument();
  });

  it("renders zero days present as a counted zero, never as an abstention", () => {
    // `daysPresent` is DERIVED: 0 means the count ran and no record named a
    // day. A dash would claim an abstention the server did not make, and the
    // undated badge beside it already says why the count is zero.
    renderTable([
      country({
        code: "SI",
        kinds: ["lodging"],
        evidence: "lodging",
        tier: "slept",
        entries: 0,
        airports: [],
        firstYear: null,
        lastYear: null,
        hasUndatedEvidence: true,
        daysPresent: 0,
        groundTime: { state: "notApplicable" },
      }),
    ]);

    const days = screen.getByTestId("days-present");
    expect(days).toHaveTextContent("0");
    expect(days).not.toHaveTextContent("passport:value.dash");
    expect(days).toHaveAttribute("title", "passport:value.noDatedDays");
    expect(screen.getByText("passport:countries.undated")).toBeInTheDocument();
  });
});

describe("CountryTable — provenance is reachable", () => {
  beforeEach(() => {
    getCountryDetailMock.mockReset();
  });

  it("links each named record to the page that edits it", async () => {
    getCountryDetailMock.mockResolvedValue({
      ...emptyDetail("IT"),
      timeline: [
        {
          kind: "flight",
          date: "2024-05-02",
          flightId: "f-1",
          flightNumber: "LH123",
          depIata: "MUC",
          arrIata: "FCO",
          airportIata: "FCO",
        },
        { kind: "place", date: null, placeId: "p-9", name: "Colosseo" },
      ],
    } satisfies CountryDetail);

    renderTable([country({ code: "IT", kinds: ["flight", "place"] })]);
    await userEvent.click(screen.getByText("passport:countries.showRecords"));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "LH123" })).toHaveAttribute("href", "/flights/f-1");
    });
    expect(screen.getByRole("link", { name: "Colosseo" })).toHaveAttribute("href", "/places/p-9");
    // An undated record says so rather than borrowing a neighbour's date.
    expect(screen.getByText(/passport:value.undated/)).toBeInTheDocument();
  });

  it("opens a lodging-only country and links straight to the house", async () => {
    // THE case the whole design was written for. `Hotel Sport` puts Slovenia in
    // the passport while its place ID says Bucharest; finding that took a
    // database session, and this is the path that makes it two clicks. Czechia
    // and Italy in the owner's account have the same shape.
    getCountryDetailMock.mockResolvedValue({
      ...emptyDetail("SI"),
      evidence: "lodging",
      lodgings: 1,
      timeline: [{ kind: "lodging", date: null, lodgingId: "l-7", name: "Hotel Sport" }],
    } satisfies CountryDetail);

    renderTable([
      country({
        code: "SI",
        kinds: ["lodging"],
        evidence: "lodging",
        tier: "slept",
        entries: 0,
        airports: [],
        hasUndatedEvidence: true,
        daysPresent: 0,
        groundTime: { state: "notApplicable" },
      }),
    ]);
    await userEvent.click(screen.getByText("passport:countries.showRecords"));

    // The house itself, not the lodging list: a list is where a reader starts
    // hunting, and the promise of §3.4 is that they do not have to.
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Hotel Sport" })).toHaveAttribute(
        "href",
        "/lodging/l-7"
      );
    });
    expect(screen.getByText(/passport:value.undated/)).toBeInTheDocument();
    expect(screen.queryByText(/passport:provenance.none/)).not.toBeInTheDocument();
    expect(screen.queryByText("passport:provenance.loadError")).not.toBeInTheDocument();
  });

  it("treats a 404 as an empty answer, not as a broken request", async () => {
    // The endpoint still 404s when NOTHING evidences a country — a house whose
    // only stay is a future booking, a house whose stays were all cancelled.
    // Neither proves anything to `lodgingEvidence`, so neither raises a row
    // either; but if one ever reaches here it must not be reported as an
    // incident, and must not read as "this country has no evidence".
    getCountryDetailMock.mockRejectedValue(
      Object.assign(new Error("not found"), { isAxiosError: true, response: { status: 404 } })
    );

    renderTable([country({ code: "SI", kinds: ["lodging"], evidence: "lodging", tier: "slept" })]);
    await userEvent.click(screen.getByText("passport:countries.showRecords"));

    await waitFor(() => {
      expect(screen.getByText(/passport:provenance.none/)).toBeInTheDocument();
    });
    expect(screen.queryByText("passport:provenance.loadError")).not.toBeInTheDocument();
  });

  it("says the records could not be loaded when the request actually breaks", async () => {
    getCountryDetailMock.mockRejectedValue(
      Object.assign(new Error("boom"), { isAxiosError: true, response: { status: 500 } })
    );

    renderTable([country({ code: "DE" })]);
    await userEvent.click(screen.getByText("passport:countries.showRecords"));

    await waitFor(() => {
      expect(screen.getByText("passport:provenance.loadError")).toBeInTheDocument();
    });
    expect(screen.queryByText("passport:provenance.none")).not.toBeInTheDocument();
  });
});
