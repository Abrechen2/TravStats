import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanCreate } from "../PlanCreate";
import { routePlan } from "../route/__tests__/routeFixture";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  write: vi.fn(),
  places: vi.fn(),
  t: (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${Object.values(opts).join(",")}` : key,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/travplan", () => ({
  travplanApi: { create: mocks.create, write: mocks.write, places: mocks.places },
}));

const kiel = {
  name: "Kiel",
  lat: 54.3,
  lon: 10.1,
  country: "DE",
  zone: "Europe/Berlin",
  ref: null,
};
const oslo = { name: "Oslo", lat: 59.9, lon: 10.7, country: "NO", zone: "Europe/Oslo", ref: null };
const hit = (place: typeof kiel) => ({
  places: [{ source: "port", visits: null, place }],
  unavailable: [],
});

async function pick(label: string, query: string, place: string) {
  await userEvent.type(screen.getByRole("textbox", { name: label }), query);
  await userEvent.click(
    await screen.findByRole("button", { name: new RegExp(place) }, { timeout: 2000 })
  );
}

describe("PlanCreate", () => {
  beforeEach(() => {
    mocks.create.mockReset().mockResolvedValue(routePlan());
    mocks.write.mockReset().mockImplementation(async (plan) => plan);
    mocks.places.mockReset();
  });

  it("takes time zone and currency from the picked place and shows them editable", async () => {
    mocks.places.mockResolvedValue(hit(oslo));
    render(<PlanCreate onClose={vi.fn()} onCreated={vi.fn()} />);
    await pick("create.destinationSearch", "oslo", "Oslo");
    expect(screen.getByLabelText("fields.timezone")).toHaveValue("Europe/Oslo");
    expect(screen.getByLabelText("fields.currency")).toHaveValue("NOK");
    expect(screen.getByLabelText("create.name")).toHaveValue("Oslo");
  });

  it("creates a destination plan with the picked coordinates", async () => {
    mocks.places.mockResolvedValue(hit(oslo));
    const onCreated = vi.fn();
    render(<PlanCreate onClose={vi.fn()} onCreated={onCreated} />);
    await pick("create.destinationSearch", "oslo", "Oslo");
    await userEvent.type(screen.getByLabelText("fields.startDay"), "2026-07-01");
    await userEvent.type(screen.getByLabelText("fields.endDay"), "2026-07-10");
    await userEvent.click(screen.getByRole("button", { name: "create.next" }));
    await userEvent.click(screen.getByRole("button", { name: "create.finish" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mocks.create).toHaveBeenCalledWith(
      "Oslo",
      expect.objectContaining({
        destination: "Oslo",
        latitude: 59.9,
        longitude: 10.7,
        timezone: "Europe/Oslo",
        currency: "NOK",
      })
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("builds a route plan from start, goal and the way back, with a stage between each pair", async () => {
    mocks.places.mockResolvedValueOnce(hit(kiel)).mockResolvedValueOnce(hit(oslo));
    render(<PlanCreate onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "create.shapeRoute" }));
    await pick("create.startSearch", "kiel", "Kiel");
    await pick("create.destinationSearch", "oslo", "Oslo");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByLabelText("fields.startDay"), "2026-07-01");
    await userEvent.type(screen.getByLabelText("fields.endDay"), "2026-07-10");
    await userEvent.click(screen.getByRole("button", { name: "create.next" }));
    await userEvent.click(screen.getByRole("button", { name: "create.finish" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(6));
    const ops = mocks.write.mock.calls.map((c) => c[1]);
    expect(ops[0]).toEqual({ type: "route_settings", shape: "route" });
    expect(ops.slice(1, 4).map((o) => o.value.title)).toEqual(["Kiel", "Oslo", "Kiel"]);
    expect(ops.slice(4).every((o) => o.collection === "stages")).toBe(true);
  });

  it("keeps the plan it made when a later step fails, and never makes a second one", async () => {
    mocks.places.mockResolvedValueOnce(hit(kiel)).mockResolvedValueOnce(hit(oslo));
    mocks.write.mockRejectedValueOnce({ response: { data: { code: "PLAN_REVISION_CONFLICT" } } });
    const onCreated = vi.fn();
    render(<PlanCreate onClose={vi.fn()} onCreated={onCreated} />);
    await userEvent.click(screen.getByRole("button", { name: "create.shapeRoute" }));
    await pick("create.startSearch", "kiel", "Kiel");
    await pick("create.destinationSearch", "oslo", "Oslo");
    await userEvent.type(screen.getByLabelText("fields.startDay"), "2026-07-01");
    await userEvent.type(screen.getByLabelText("fields.endDay"), "2026-07-10");
    await userEvent.click(screen.getByRole("button", { name: "create.next" }));
    await userEvent.click(screen.getByRole("button", { name: "create.finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("create.partial");
    expect(screen.queryByRole("button", { name: "create.finish" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "create.openPlan" }));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
