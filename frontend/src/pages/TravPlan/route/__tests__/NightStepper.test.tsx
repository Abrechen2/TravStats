import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NightStepper } from "../NightStepper";
import { routeState } from "./routeFixture";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(",")}` : key,
  }),
}));
vi.mock("../../format", () => ({ planDay: (d: string) => d }));

const withBookedFerry = () => {
  const base = routeState();
  return {
    ...base,
    stages: base.stages.map((g) => (g.id === "g2" ? { ...g, bookingId: "bk-booked" } : g)),
  };
};

describe("NightStepper", () => {
  it("takes a night away at once", async () => {
    const onWrite = vi.fn();
    const state = routeState();
    render(
      <NightStepper state={state} station={state.stations[0]} busy={false} onWrite={onWrite} />
    );
    await userEvent.click(screen.getByRole("button", { name: "route.nights.less:Kiel" }));
    expect(onWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "stations",
        value: expect.objectContaining({ id: "a", nights: 1 }),
      })
    );
  });

  it("asks before one more night pushes towards a booked leg, and names it", async () => {
    const onWrite = vi.fn();
    const state = withBookedFerry();
    render(
      <NightStepper state={state} station={state.stations[0]} busy={false} onWrite={onWrite} />
    );
    await userEvent.click(screen.getByRole("button", { name: "route.nights.more:Kiel" }));
    expect(onWrite).not.toHaveBeenCalled();
    expect(
      screen.getByText(/route.nights.fixed:Kiel,Kiel - Gothenburg \(2026-05-03\)/)
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "route.nights.anyway" }));
    expect(onWrite).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.objectContaining({ id: "a", nights: 3 }) })
    );
  });

  it("adds a night at once when nothing fixed follows, and cannot go below zero", async () => {
    const onWrite = vi.fn();
    const state = routeState();
    const empty = { ...state.stations[1], nights: 0 };
    render(<NightStepper state={state} station={empty} busy={false} onWrite={onWrite} />);
    expect(screen.getByRole("button", { name: "route.nights.less:Gothenburg" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "route.nights.more:Gothenburg" }));
    expect(onWrite).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.objectContaining({ nights: 1 }) })
    );
  });
});
