import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteSection } from "../RouteSection";
import type { PlanCtx } from "../../planContext";
import type { PlanView } from "../../../../lib/api/travplan";
import { routePlan } from "./routeFixture";

const mocks = vi.hoisted(() => ({
  routeStage: vi.fn(),
  places: vi.fn(),
  t: (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${Object.values(opts).join(",")}` : key,
}));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: "de" } }),
}));
vi.mock("../../../../lib/api/travplan", () => ({
  travplanApi: { routeStage: mocks.routeStage, places: mocks.places },
}));
vi.mock("../RouteMap", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("../../../../lib/webgl2", () => ({ probeWebGL2: () => true }));

function ctx(plan: PlanView, over: Partial<PlanCtx> = {}): PlanCtx {
  return {
    plan,
    state: plan.state,
    busy: false,
    prefix: "/plan/route-trip",
    tripId: plan.tripId,
    mutate: vi.fn().mockResolvedValue(true),
    setPlan: vi.fn(),
    onError: vi.fn(),
    edit: vi.fn(),
    ...over,
  } as unknown as PlanCtx;
}

describe("RouteSection", () => {
  beforeEach(() => {
    mocks.routeStage.mockReset();
    mocks.places.mockReset();
  });

  it("lists every station with its night and the stage that joins it to the next", async () => {
    render(<RouteSection ctx={ctx(routePlan())} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["Kiel", "Gothenburg", "Oslo"])
    );
    expect(screen.getByText(/Kiel → Gothenburg/)).toBeInTheDocument();
    expect(screen.getByText(/Gothenburg → Oslo/)).toBeInTheDocument();
    expect(await screen.findByTestId("map")).toBeInTheDocument();
  });

  it("shows an unknown distance as a dash, never as 0 km", async () => {
    const plan = routePlan();
    plan.state = {
      ...plan.state,
      stages: plan.state.stages.map((g) => ({
        ...g,
        distanceKm: null,
        durationMinutes: null,
        metricsSource: null,
      })),
    };
    render(<RouteSection ctx={ctx(plan)} />);
    await screen.findByTestId("map");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getAllByText("–").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("route.stats.unmeasured:2")).toBeInTheDocument();
  });

  it("says why a stage fell back to a straight line and keeps its stored figures on screen", () => {
    render(<RouteSection ctx={ctx(routePlan())} />);
    // g2 in the fixture: straight line because the router failed; its 40 km stay visible
    expect(
      screen.getByText(/route\.stage\.reason:route\.stage\.reasons\.provider_error/)
    ).toBeInTheDocument();
    expect(screen.getByText(/40 km/)).toBeInTheDocument();
  });

  it("offers the handover only for a station that has been reached, and sends the operation", async () => {
    const plan = routePlan();
    // a: 2026-05-01 - reached once 'today' is later; the clock is far past it. b/c: also in the past.
    const mutate = vi.fn().mockResolvedValue(true);
    plan.schedule = {
      ...plan.schedule!,
      stations: plan.schedule!.stations.map((s) =>
        s.stationId === "c" ? { ...s, arriveDay: "2999-01-01" } : s
      ),
    };
    render(<RouteSection ctx={ctx(plan, { mutate })} />);
    const buttons = screen.getAllByRole("button", { name: "route.handover.confirm" });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[0]);
    expect(mutate).toHaveBeenCalledWith({ type: "station_handover", stationId: "a" });
  });

  it("offers a withdrawal, not a second handover, for a station the plan wrote", async () => {
    const plan = routePlan();
    plan.state = {
      ...plan.state,
      stationLinks: [
        { stationId: "a", tripStopId: "x", created: [{ kind: "stop", id: "x", version: "v" }] },
      ],
    };
    const mutate = vi.fn().mockResolvedValue(true);
    render(<RouteSection ctx={ctx(plan, { mutate })} />);
    await userEvent.click(screen.getByRole("button", { name: "route.handover.withdraw" }));
    expect(mutate).toHaveBeenCalledWith({ type: "station_withdraw", stationId: "a" });
  });

  it("recalculates one stage on the server and shows a failed request instead of swallowing it", async () => {
    const onError = vi.fn();
    const setPlan = vi.fn();
    mocks.routeStage.mockRejectedValueOnce(new Error("offline"));
    render(<RouteSection ctx={ctx(routePlan(), { onError, setPlan })} />);
    await userEvent.click(screen.getAllByRole("button", { name: "route.stage.recalculate" })[0]);
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(setPlan).not.toHaveBeenCalled();
  });

  it("takes the server's answer for a recalculation, including the reason it recorded", async () => {
    const setPlan = vi.fn();
    const answer = routePlan({ revision: 9 });
    mocks.routeStage.mockResolvedValueOnce(answer);
    render(<RouteSection ctx={ctx(routePlan(), { setPlan })} />);
    await userEvent.click(screen.getAllByRole("button", { name: "route.stage.recalculate" })[1]);
    await waitFor(() => expect(setPlan).toHaveBeenCalledWith(answer));
    expect(mocks.routeStage).toHaveBeenCalledWith(expect.anything(), "g2");
  });

  it("adds a picked place as a station and joins it to the last one with a stage", async () => {
    const mutate = vi.fn().mockResolvedValue(true);
    const place = {
      name: "Bergen",
      lat: 60.4,
      lon: 5.3,
      country: "NO",
      zone: "Europe/Oslo",
      ref: null,
    };
    mocks.places.mockResolvedValue({
      places: [{ source: "port", visits: null, place }],
      unavailable: [],
    });
    render(<RouteSection ctx={ctx(routePlan(), { mutate })} />);
    const search = screen.getByRole("textbox", { name: "route.add.search" });
    await userEvent.type(search, "bergen");
    await userEvent.click(await screen.findByRole("button", { name: /Bergen/ }, { timeout: 2000 }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    const [first, second] = mutate.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({
      type: "upsert",
      collection: "stations",
      value: { title: "Bergen", place },
    });
    expect(second).toMatchObject({
      type: "upsert",
      collection: "stages",
      value: { fromStationId: "c", toStationId: first.value.id },
    });
  });

  it("starts an empty route with a start place, not an empty page", () => {
    const plan = routePlan();
    plan.state = { ...plan.state, stations: [], stages: [] };
    render(<RouteSection ctx={ctx(plan)} />);
    expect(screen.getByText("route.empty.title")).toBeInTheDocument();
    expect(
      within(screen.getByText("route.empty.title").closest("div")!.parentElement!).getByRole(
        "textbox"
      )
    ).toBeInTheDocument();
  });
});
