import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanActualPanel } from "../sections/PlanActualPanel";
import type { PlanCtx } from "../planContext";
import type { PlanActual, PlanStation } from "../../../lib/api/travplan";
import { planFixture } from "./planFixture";

const mocks = vi.hoisted(() => ({
  actual: vi.fn(),
  t: (key: string, opts?: Record<string, unknown>) =>
    opts && "count" in opts ? `${key}:${String(opts.count)}` : key,
}));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../../lib/api/travplan", () => ({ travplanApi: { actual: mocks.actual } }));

const station = (id: string, title: string, lat: number, lon: number): PlanStation => ({
  id,
  title,
  place: { name: title, lat, lon, country: null, zone: null, ref: null },
  nights: 1,
  pinnedDay: null,
  night: { kind: "spontaneous" },
  note: "",
});
const STATIONS = [
  station("m", "München", 48.1, 11.6),
  station("s", "Salzburg", 47.8, 13.1),
  station("l", "Linz", 48.3, 14.3),
  station("v", "Wien", 48.2, 16.4),
];

function ctx(stations: PlanStation[] = STATIONS): PlanCtx {
  const plan = planFixture("trip-one", 4);
  plan.state = { ...plan.state, shape: "route", stations };
  return { plan, state: plan.state, tripId: "trip-one", onError: vi.fn() } as unknown as PlanCtx;
}

const row = (stationId: string, title: string, status: string, deltaDays: number | null) => ({
  stationId,
  title,
  plannedFrom: "2026-10-01",
  plannedUntil: "2026-10-02",
  status,
  deltaDays,
  actualFrom: status === "visited" || status === "shifted" ? "2026-10-01" : null,
  actualUntil: null,
});

function answer(overrides: Partial<PlanActual> = {}): PlanActual {
  return {
    plan: { revision: 4 },
    actual: {
      origin: "dawarich",
      coverage: "complete",
      days: [],
      segments: [
        [
          [11.6, 48.1],
          [16.4, 48.2],
        ],
      ],
    },
    stations: [
      row("m", "München", "visited", 0),
      row("s", "Salzburg", "shifted", 2),
      row("l", "Linz", "skipped", null),
      row("v", "Wien", "unknown", null),
    ] as PlanActual["stations"],
    stages: [
      { stageId: "g", fromStationId: "m", toStationId: "s", plannedKm: 145, actualKm: null },
    ],
    unplanned: [{ kind: "lodging", day: "2026-10-03", lat: 47.4, lon: 8.5, label: "Hotel Zürich" }],
    ...overrides,
  };
}

// A block, not an expression: a function returned from beforeEach is run as its teardown.
beforeEach(() => {
  mocks.actual.mockReset();
});

describe("PlanActualPanel", () => {
  it("shows the four states, the origin and a stage without an actual length", async () => {
    mocks.actual.mockResolvedValue(answer());
    render(<PlanActualPanel ctx={ctx()} />);
    expect(await screen.findByText("actual.status.visited")).toBeInTheDocument();
    expect(screen.getByText("actual.status.shifted")).toBeInTheDocument();
    expect(screen.getByText("actual.status.skipped")).toBeInTheDocument();
    expect(screen.getByText("actual.status.unknown")).toBeInTheDocument();
    expect(screen.getByText(/actual\.later:2/)).toBeInTheDocument();
    expect(screen.getByText("actual.origin.dawarich")).toBeInTheDocument();
    expect(screen.getByText(/actual\.actualKmUnknown/)).toBeInTheDocument();
    expect(screen.getByText("Hotel Zürich")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "actual.sketchLabel" })).toBeInTheDocument();
    expect(mocks.actual).toHaveBeenCalledWith("trip-one");
  });

  it("offers nothing that would change the plan", async () => {
    mocks.actual.mockResolvedValue(answer());
    render(<PlanActualPanel ctx={ctx()} />);
    await screen.findByText("actual.status.visited");
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("no track says so, instead of counting stations as skipped", async () => {
    mocks.actual.mockResolvedValue(
      answer({
        actual: null,
        stations: STATIONS.map((s) =>
          row(s.id, s.title, "unknown", null)
        ) as PlanActual["stations"],
      })
    );
    render(<PlanActualPanel ctx={ctx()} />);
    expect(await screen.findByText("actual.noTrack")).toBeInTheDocument();
    expect(screen.queryByText("actual.status.skipped")).not.toBeInTheDocument();
  });

  it("an unreachable source is said as a failure", async () => {
    mocks.actual.mockResolvedValue(
      answer({ actual: { origin: "dawarich", coverage: "unreachable", days: [], segments: [] } })
    );
    render(<PlanActualPanel ctx={ctx()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("actual.unreachable");
  });

  it("a failed load reaches the user as itself", async () => {
    const c = ctx();
    const cause = Object.assign(new Error("403"), {
      response: { status: 403, data: { code: "PLAN_DISABLED" } },
    });
    mocks.actual.mockRejectedValue(cause);
    render(<PlanActualPanel ctx={c} />);
    expect(await screen.findByText("actual.failed")).toBeInTheDocument();
    expect(c.onError).toHaveBeenCalledWith(cause);
  });

  it("a plan without stations asks nothing of the server", () => {
    render(<PlanActualPanel ctx={ctx([])} />);
    expect(screen.getByText("actual.noRoute")).toBeInTheDocument();
    expect(mocks.actual).not.toHaveBeenCalled();
  });
});
