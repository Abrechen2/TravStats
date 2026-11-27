import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DriveSplits, VehicleLimits } from "../DriveLimits";
import type { PlanView } from "../../../../lib/api/travplan";
import { routePlan } from "./routeFixture";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(",")}` : key,
  }),
}));

const vehicle = {
  kind: "motorhome" as const,
  lengthM: null,
  consumptionPer100: null,
  fuelPrice: null,
  fuelCurrency: null,
};

function planWithSplit(): PlanView {
  const plan = routePlan();
  plan.state = { ...plan.state, vehicle: { ...vehicle, maxDriveMinutesPerDay: 60 } };
  plan.schedule = {
    ...plan.schedule!,
    splits: [
      {
        stageId: "g1",
        days: 2,
        legs: [
          { minutes: 45, km: 30 },
          { minutes: 45, km: 30 },
        ],
        stops: [{ lat: 56, lon: 11, afterMinutes: 45, afterKm: 30 }],
        approximate: true,
      },
    ],
  };
  plan.findings = [
    {
      id: "driveSplit:g1",
      fingerprint: "fp",
      code: "driveSplit",
      severity: "info",
      section: "route",
      params: {},
    },
  ];
  return plan;
}

describe("VehicleLimits", () => {
  it("saves hours as minutes and km, keeping the vehicle, and an empty field clears the limit", async () => {
    const mutate = vi.fn().mockResolvedValue(true);
    const plan = routePlan();
    plan.state = { ...plan.state, vehicle };
    render(<VehicleLimits plan={plan} busy={false} mutate={mutate} />);
    await userEvent.type(screen.getByLabelText("route.limits.hours"), "5,5");
    await userEvent.click(screen.getByRole("button", { name: "route.limits.save" }));
    expect(mutate).toHaveBeenCalledWith({
      type: "route_settings",
      vehicle: { ...vehicle, maxDriveMinutesPerDay: 330, maxDriveKmPerDay: null },
    });
  });

  it("refuses a number the server would refuse and says so beside the field", async () => {
    const mutate = vi.fn();
    render(<VehicleLimits plan={routePlan()} busy={false} mutate={mutate} />);
    await userEvent.type(screen.getByLabelText("route.limits.km"), "5");
    await userEvent.click(screen.getByRole("button", { name: "route.limits.save" }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("route.limits.invalid")).toBeInTheDocument();
  });
});

describe("DriveSplits", () => {
  it("shows a suggestion only while its finding is open", () => {
    const plan = planWithSplit();
    plan.findings = [];
    const { container } = render(<DriveSplits plan={plan} busy={false} mutate={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("confirming writes the stop as a station and rewires the drive through it", async () => {
    const mutate = vi.fn().mockResolvedValue(true);
    render(<DriveSplits plan={planWithSplit()} busy={false} mutate={mutate} />);
    await userEvent.click(screen.getByRole("button", { name: "route.split.confirm" }));
    const ops = mutate.mock.calls.map((c) => c[0]);
    const station = ops.find((o) => o.type === "upsert" && o.collection === "stations");
    expect(station.value).toMatchObject({ place: { lat: 56, lon: 11 }, nights: 1 });
    expect(ops.some((o) => o.type === "move_station")).toBe(true);
    expect(ops.filter((o) => o.type === "upsert" && o.collection === "stages")).toHaveLength(2);
  });

  it("dismissing records a decision on the finding and creates no station", async () => {
    const mutate = vi.fn().mockResolvedValue(true);
    render(<DriveSplits plan={planWithSplit()} busy={false} mutate={mutate} />);
    await userEvent.click(screen.getByRole("button", { name: "route.split.dismiss" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      type: "decision",
      value: { id: "driveSplit:g1", fingerprint: "fp", choice: "dismissed" },
    });
  });
});
