import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { JSX } from "react";
import type { TourInsights } from "../../../../types/statsInsights";

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const gate = vi.hoisted(() => ({ tours: true }));
vi.mock("../../../../hooks/useToursVisible", () => ({ useToursVisible: () => gate.tours }));
const tours = vi.fn();
vi.mock("../../../../lib/api/statsInsights", () => ({
  statsInsightsApi: { tours: (...a: unknown[]) => tours(...a) },
}));

import TourStatsSection from "../TourStatsSection";

const none = { total: 0, tours: 0 };
const EMPTY: TourInsights = {
  byActivity: [],
  all: {
    activity: "all",
    completed: 0,
    km: none,
    ascentM: none,
    movingSeconds: none,
    pauseSeconds: none,
  },
  records: [],
  rhythm: {
    byYear: [],
    byMonth: Array(12).fill(0),
    firstAreas: [],
    repeatedAreas: [],
    withoutArea: 0,
  },
  links: {
    onTrip: 0,
    fromRoadtrip: 0,
    duringCruise: 0,
    standalone: 0,
    excursions: { completed: 0, km: 0, planned: 0 },
  },
  planned: 0,
  undated: 2,
  partial: 0,
  totals: {},
};

const hike = {
  activity: "hike",
  completed: 2,
  km: { total: 28, tours: 2 },
  ascentM: { total: 1100, tours: 1 },
  movingSeconds: { total: 21600, tours: 1 },
  pauseSeconds: { total: 3600, tours: 1 },
};
const FULL: TourInsights = {
  ...EMPTY,
  byActivity: [
    hike,
    {
      ...hike,
      activity: "excursion",
      completed: 1,
      km: { total: 80, tours: 1 },
      ascentM: none,
      movingSeconds: none,
      pauseSeconds: none,
    },
  ],
  all: { ...hike, activity: "all", completed: 3, km: { total: 108, tours: 3 } },
  records: [
    {
      activity: "hike",
      longest: { tourId: "t1", name: "Zugspitze", value: 21, source: "track" },
      mostAscent: { tourId: "t1", name: "Zugspitze", value: 1100 },
      highest: { tourId: "t1", name: "Zugspitze", value: 2962 },
    },
  ],
  rhythm: {
    byYear: [{ year: 2024, tours: 3 }],
    byMonth: [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0],
    firstAreas: [{ country: "DE", day: "2024-05-01", tourId: "t1", name: "Zugspitze" }],
    repeatedAreas: [],
    withoutArea: 0,
  },
  links: {
    onTrip: 1,
    fromRoadtrip: 1,
    duringCruise: 1,
    standalone: 1,
    excursions: { completed: 1, km: 80, planned: 1 },
  },
  planned: 1,
  undated: 0,
  totals: {
    tourCompletedCount: { allTime: 3, byYear: { "2024": 3 } },
    tourDistanceKm: { allTime: 108, byYear: { "2024": 108 } },
    tourAscentM: { allTime: 1100, byYear: { "2024": 1100 } },
    tourMovingMinutes: { allTime: 360, byYear: { "2024": 360 } },
  },
};

function Url(): JSX.Element {
  return <span data-testid="url">{useLocation().search}</span>;
}

function renderAt(year: number | null): void {
  render(
    <MemoryRouter>
      <TourStatsSection year={year} accent="#a9c46a" />
      <Url />
    </MemoryRouter>
  );
}

describe("TourStatsSection (forgejo#264)", () => {
  beforeEach(() => tours.mockReset());

  it("reports each activity with what its figures rest on", async () => {
    tours.mockResolvedValueOnce(FULL);
    renderAt(null);
    const rows = await screen.findByTestId("tour-activities-rows");
    expect(rows.textContent).toContain("Wanderung");
    expect(rows.textContent).toContain("1.100 Hm (1 gemessen)");
    expect(rows.textContent).toContain("Geführter Ausflug");
  });

  it("shows moving time and pauses apart, from recordings only", async () => {
    tours.mockResolvedValueOnce(FULL);
    renderAt(2024);
    const moving = await screen.findByTestId("tour-moving");
    expect(moving.textContent).toContain("6 Std. in Bewegung");
    expect(moving.textContent).toContain("1 Std. Pause – aus 1 von 3 Touren, über alle Jahre");
    fireEvent.click(
      within(moving).getByRole("button", { name: "Bewegungszeit aus Aufzeichnungen" })
    );
    expect(screen.getByTestId("url").textContent).toContain("evidence=metric%3AtourMovingMinutes");
  });

  it("formats moving time to the minute, never rounded to whole hours (review I1)", async () => {
    tours.mockResolvedValueOnce({
      ...FULL,
      byActivity: [
        { ...hike, completed: 1, movingSeconds: { total: 1500, tours: 1 } },
        { ...hike, activity: "bike", completed: 1, movingSeconds: { total: 12600, tours: 1 } },
      ],
      all: {
        ...FULL.all,
        movingSeconds: { total: 5400, tours: 2 },
        pauseSeconds: { total: 1500, tours: 2 },
      },
      totals: { ...FULL.totals, tourMovingMinutes: { allTime: 90, byYear: { "2024": 90 } } },
    });
    renderAt(null);
    const rows = await screen.findByTestId("tour-activities-rows");
    expect(rows.textContent).toContain("25 Min. in Bewegung");
    expect(rows.textContent).toContain("3 Std. 30 Min. in Bewegung");
    const moving = screen.getByTestId("tour-moving");
    expect(moving.textContent).toContain("1 Std. 30 Min. in Bewegung");
    expect(moving.textContent).toContain("25 Min. Pause");
  });

  it("names records with their source and links each to its tour", async () => {
    tours.mockResolvedValueOnce(FULL);
    renderAt(null);
    const records = await screen.findByTestId("tour-records");
    expect(records.textContent).toContain("längste Tour, 21 km (aufgezeichnet)");
    expect(records.textContent).toContain("höchster Punkt, 2.962 m");
    expect(within(records).getAllByRole("link")[0].getAttribute("href")).toBe("/tours/t1");
  });

  it("keeps guided excursions out of bus rides and driven kilometres", async () => {
    tours.mockResolvedValueOnce(FULL);
    renderAt(null);
    const excursions = await screen.findByTestId("tour-links-excursions");
    expect(excursions.textContent).toContain("nie als Busfahrt oder gefahrene Kilometer");
  });

  it("explains an empty tab from the data the user has, and counts sketches apart", async () => {
    tours.mockResolvedValueOnce(EMPTY);
    renderAt(null);
    expect((await screen.findByTestId("tour-activities-empty")).textContent).toContain(
      "aufgezeichnet ist oder ihr Datum vorbei ist"
    );
    expect(screen.getByTestId("tour-activities-help").textContent).toContain(
      "2 haben weder Tag noch Aufzeichnung"
    );
  });
});

// The one tour rule (`useToursVisible`): no tours on the instance, no section
// and no request.
describe("TourStatsSection while tours are not shown", () => {
  it("draws nothing", () => {
    gate.tours = false;
    try {
      const { container } = render(
        <MemoryRouter>
          <TourStatsSection year={null} accent="#000" />
        </MemoryRouter>
      );
      expect(container).toBeEmptyDOMElement();
    } finally {
      gate.tours = true;
    }
  });
});
