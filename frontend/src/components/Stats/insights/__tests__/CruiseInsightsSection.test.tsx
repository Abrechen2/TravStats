import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

import type { CruiseInsights, CruiseRef } from "../../../../types/cruiseInsights";
import { EVIDENCE_MEASURES } from "../../../../shared/evidenceMeasures";
import { expectNoNestedTriggers } from "../../__tests__/noNestedTriggers";
import { useEvidenceOpenStore } from "../../../evidence/evidenceOpenStore";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
const getCruiseInsights = vi.fn();
vi.mock("../../../../lib/api", () => ({
  statsApi: { getCruiseInsights: (year: number | null) => getCruiseInsights(year) },
}));

import CruiseInsightsSection from "../CruiseInsightsSection";

/**
 * forgejo#257 on the web: every count opens the voyages behind it under the
 * tab's year, single voyages link the cruise, an absent figure reads as absent
 * — "no excursions documented", never "0 excursions" — and tours are not
 * mentioned at all while the reader does not see them.
 */

const norway: CruiseRef = { id: "c-norway", label: "Norwegen", startDate: "2024-06-01" };
const sumatra: CruiseRef = { id: "c-asia", label: "Südostasien", startDate: "2024-02-01" };

const INSIGHTS: CruiseInsights = {
  year: 2024,
  cruises: 2,
  events: {
    birthdayKnown: false,
    list: [
      { event: "equator", cruises: [sumatra] },
      { event: "dateline", cruises: [] },
      { event: "birthdayAtSea", cruises: [] },
      { event: "newYearAtSea", cruises: [] },
      { event: "canal", cruises: [] },
      { event: "polar", cruises: [] },
    ],
  },
  ports: {
    years: [
      { year: 2024, cruises: 2, ports: 5, newPorts: [{ id: 1, name: "Oslo" }], revisitedPorts: 2 },
    ],
    perCruise: [
      { cruise: sumatra, ports: 2, newPorts: 0, revisitedPorts: 2, unresolvedCalls: 0 },
      { cruise: norway, ports: 3, newPorts: 1, revisitedPorts: 0, unresolvedCalls: 0 },
    ],
    longestReunion: null,
    repeatPorts: [],
    undatedCruises: 0,
    unresolvedCalls: 0,
  },
  portStays: {
    calls: 3,
    measured: 0,
    missingTime: 3,
    inconsistent: 0,
    totalMinutes: 0,
    averageMinutes: null,
    longest: null,
    shortest: null,
  },
  excursions: {
    toursVisible: true,
    linkRuleKm: 100,
    cruisesWithExcursions: 1,
    documentedCalls: 1,
    portsWithExcursions: 1,
    perCruise: [
      {
        cruise: norway,
        calls: 2,
        notedCalls: 0,
        documentedCalls: 1,
        tours: [
          {
            id: "t1",
            name: "Fløyen",
            activity: "hike",
            day: "2024-06-04",
            portName: "Bergen",
            recordedKm: 7.5,
            plannedKm: null,
            ascentM: 320,
          },
        ],
        activities: { hike: 1 },
        recordedKm: 7.5,
        plannedKm: null,
        onFootRecordedKm: 7.5,
        onFootPlannedKm: null,
        ascentM: 320,
      },
      {
        cruise: sumatra,
        calls: 1,
        notedCalls: 0,
        documentedCalls: 0,
        tours: [],
        activities: {},
        recordedKm: null,
        plannedKm: null,
        onFootRecordedKm: null,
        onFootPlannedKm: null,
        ascentM: null,
      },
    ],
  },
  dayPattern: {
    years: [
      {
        year: 2024,
        cruises: 2,
        seaDays: 3,
        portDays: 4,
        seaHeavy: 1,
        balanced: 1,
        portIntensive: 0,
        unclassified: 0,
      },
    ],
    perCruise: [
      { cruise: norway, seaDays: 1, portDays: 2, listedDays: 3, unlistedDays: 1, type: "balanced" },
    ],
  },
  repeatedItineraries: [],
};

let search = "";
function LocationProbe(): null {
  search = useLocation().search;
  return null;
}

function renderSection(year: number | null = 2024): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <LocationProbe />
      <CruiseInsightsSection year={year} />
    </MemoryRouter>
  );
}

describe("CruiseInsightsSection (forgejo#257)", () => {
  beforeEach(() => {
    getCruiseInsights.mockReset();
    search = "";
  });

  it("asks for the tab's year", async () => {
    getCruiseInsights.mockResolvedValue(INSIGHTS);
    renderSection(2024);
    await waitFor(() => expect(getCruiseInsights).toHaveBeenCalledWith(2024));
  });

  it("opens the voyage that crossed the equator, under the tab's year", async () => {
    getCruiseInsights.mockResolvedValue(INSIGHTS);
    const { container } = renderSection(2024);
    const trigger = await screen.findByRole("button", {
      name: "stats:insights.cruise.events.names.equator",
    });
    act(() => trigger.click());
    expect(search).toContain("cruiseEquatorCruiseCount");
    expect(useEvidenceOpenStore.getState().scope).toEqual({ period: "year", year: 2024 });
    expect(useEvidenceOpenStore.getState().renderedValue).toBe(1);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toContain(
      "/cruises/c-asia"
    );
    expectNoNestedTriggers(container);
  });

  it("says what would enable the birthday event instead of counting none", async () => {
    getCruiseInsights.mockResolvedValue(INSIGHTS);
    renderSection();
    expect(await screen.findByText("stats:insights.cruise.events.noBirthday")).toBeTruthy();
    expect(screen.getAllByText("stats:insights.cruise.events.none")).toHaveLength(4);
  });

  it("wires only keys a resolver serves", async () => {
    getCruiseInsights.mockResolvedValue(INSIGHTS);
    renderSection();
    await screen.findByText("stats:insights.cruise.ports.title");
    const opened = new Set<string>();
    for (const button of screen.getAllByRole("button")) {
      if (button.getAttribute("aria-haspopup") !== "dialog") continue;
      act(() => button.click());
      const key = /metric(?:%3A|:)([A-Za-z]+)/.exec(search)?.[1];
      if (key) opened.add(key);
    }
    expect([...opened].sort()).toEqual([
      "cruiseDocumentedExcursionCount",
      "cruiseEquatorCruiseCount",
      "cruiseNewPortsCount",
      "cruisePortDaysTotal",
      "cruisePortRevisitCount",
    ]);
    for (const key of opened) expect(EVIDENCE_MEASURES[key]?.servedIn).toBe(1);
  });

  it("reads a cruise without a documented excursion as such, never as zero", async () => {
    getCruiseInsights.mockResolvedValue(INSIGHTS);
    renderSection();
    expect(await screen.findByText(/stats:insights.cruise.excursions.noneDocumented/)).toBeTruthy();
    expect(screen.getByText(/roadtrips:activity.hike 1/)).toBeTruthy();
  });

  it("names unmeasured stays instead of averaging them in", async () => {
    getCruiseInsights.mockResolvedValue(INSIGHTS);
    renderSection();
    expect(await screen.findByText("stats:insights.cruise.stays.empty")).toBeTruthy();
    expect(screen.getByText("stats:insights.cruise.stays.coverage")).toBeTruthy();
  });

  it("does not mention tours while the reader does not see them", async () => {
    getCruiseInsights.mockResolvedValue({
      ...INSIGHTS,
      excursions: {
        ...INSIGHTS.excursions,
        toursVisible: false,
        documentedCalls: 0,
        perCruise: INSIGHTS.excursions.perCruise.map((c) => ({
          ...c,
          documentedCalls: 0,
          tours: null,
          activities: null,
          recordedKm: null,
          plannedKm: null,
          onFootRecordedKm: null,
          onFootPlannedKm: null,
          ascentM: null,
        })),
      },
    });
    renderSection();
    expect(await screen.findByText("stats:insights.cruise.excursions.emptyNotesOnly")).toBeTruthy();
    expect(screen.queryByText(/roadtrips:activity/)).toBeNull();
    const helps = screen.getAllByRole("button", { name: "help.about" });
    act(() => helps[helps.length - 1].focus());
    expect(screen.getByText("stats:insights.help.cruiseExcursionsNotes.short")).toBeTruthy();
  });

  it("gives every block help a keyboard reaches", async () => {
    getCruiseInsights.mockResolvedValue(INSIGHTS);
    renderSection();
    await screen.findByText("stats:insights.cruise.ports.title");
    // events, ports, reunion, itineraries, stays, days, excursions
    expect(screen.getAllByRole("button", { name: "help.about" })).toHaveLength(7);
  });

  it("never lets a slow answer for the previous year overwrite the current one", async () => {
    let answerOld: (value: CruiseInsights) => void = () => undefined;
    getCruiseInsights
      .mockImplementationOnce(() => new Promise<CruiseInsights>((resolve) => (answerOld = resolve)))
      .mockResolvedValueOnce(INSIGHTS);
    const view = render(
      <MemoryRouter>
        <CruiseInsightsSection year={2023} />
      </MemoryRouter>
    );
    view.rerender(
      <MemoryRouter>
        <CruiseInsightsSection year={2024} />
      </MemoryRouter>
    );
    await screen.findByText("stats:insights.cruise.ports.title");
    await act(async () => answerOld({ ...INSIGHTS, cruises: 0 }));
    expect(screen.queryByText("stats:insights.cruise.empty")).toBeNull();
    expect(screen.getByText("stats:insights.cruise.ports.title")).toBeTruthy();
  });

  it("explains what would enable the section when no cruise was sailed", async () => {
    getCruiseInsights.mockResolvedValue({ ...INSIGHTS, cruises: 0 });
    renderSection();
    expect(await screen.findByText("stats:insights.cruise.empty")).toBeTruthy();
  });
});
