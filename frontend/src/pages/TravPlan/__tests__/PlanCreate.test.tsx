import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanCreate } from "../PlanCreate";
import { routePlan } from "../route/__tests__/routeFixture";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  write: vi.fn(),
  places: vi.fn(),
  routeStage: vi.fn(),
  t: (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${Object.values(opts).join(",")}` : key,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/travplan", () => ({
  travplanApi: {
    create: mocks.create,
    write: mocks.write,
    places: mocks.places,
    routeStage: mocks.routeStage,
  },
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
    mocks.routeStage.mockReset().mockImplementation(async (plan) => plan);
  });

  it("takes time zone and currency from the picked place and shows them editable", async () => {
    mocks.places.mockResolvedValue(hit(oslo));
    render(<PlanCreate onClose={vi.fn()} onCreated={vi.fn()} />);
    await pick("create.destinationSearch", "oslo", "Oslo");
    expect(screen.getByLabelText("fields.timezone")).toHaveValue("Europe/Oslo");
    expect(screen.getByLabelText("fields.currency")).toHaveValue("NOK");
    expect(screen.getByLabelText("create.name")).toHaveValue("Oslo");
  });

  it("offers the time zone as a list, so a typo cannot reach the server", async () => {
    mocks.places.mockResolvedValue(hit(oslo));
    render(<PlanCreate onClose={vi.fn()} onCreated={vi.fn()} />);
    await pick("create.destinationSearch", "oslo", "Oslo");
    const zone = screen.getByLabelText("fields.timezone");
    expect(zone.tagName).toBe("SELECT");
    await userEvent.selectOptions(zone, "Europe/Rome");
    expect(zone).toHaveValue("Europe/Rome");
  });

  it("an invalid currency code keeps Weiter disabled", async () => {
    mocks.places.mockResolvedValue(hit(oslo));
    render(<PlanCreate onClose={vi.fn()} onCreated={vi.fn()} />);
    await pick("create.destinationSearch", "oslo", "Oslo");
    await userEvent.type(screen.getByLabelText("fields.startDay"), "2027-05-08");
    await userEvent.type(screen.getByLabelText("fields.endDay"), "2027-05-12");
    const cur = screen.getByLabelText("fields.currency");
    await userEvent.clear(cur);
    await userEvent.type(cur, "E1");
    expect(screen.getByRole("button", { name: "create.next" })).toBeDisabled();
    await userEvent.clear(cur);
    await userEvent.type(cur, "eur");
    expect(screen.getByRole("button", { name: "create.next" })).toBeEnabled();
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
    expect(ops[0]).toEqual({ type: "route_settings", shape: "route", vehicle: null });
    expect(ops.slice(1, 4).map((o) => o.value.title)).toEqual(["Kiel", "Oslo", "Kiel"]);
    expect(ops.slice(4).every((o) => o.collection === "stages")).toBe(true);
    // The goal holds the trip's nights; both drive stages are measured right away.
    expect(ops[2].value.nights).toBe(9);
    expect(mocks.routeStage).toHaveBeenCalledTimes(2);
  });

  it("a ferry leg becomes a ferry stage with its placeholder, crossed again on the way back", async () => {
    const genova = { ...kiel, name: "Genova", country: "IT", zone: "Europe/Rome" };
    const palermo = { ...kiel, name: "Palermo", country: "IT", zone: "Europe/Rome" };
    mocks.places
      .mockResolvedValueOnce(hit(kiel))
      .mockResolvedValueOnce(hit(genova))
      .mockResolvedValueOnce(hit(palermo));
    render(<PlanCreate onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "create.shapeRoute" }));
    await pick("create.startSearch", "kiel", "Kiel");
    await pick("create.destinationSearch", "genova", "Genova");
    await pick("create.destinationSearch", "palermo", "Palermo");
    await userEvent.selectOptions(screen.getByLabelText("create.legMode:Palermo"), "ferry");
    await userEvent.selectOptions(screen.getByLabelText("create.vehicle"), "motorhome");
    await userEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByLabelText("create.name")).toHaveValue("Palermo");
    await userEvent.type(screen.getByLabelText("fields.startDay"), "2027-05-01");
    await userEvent.type(screen.getByLabelText("fields.endDay"), "2027-05-15");
    await userEvent.click(screen.getByRole("button", { name: "create.next" }));
    await userEvent.type(screen.getByLabelText("route.mode.ferry: Genova → Palermo"), "320");
    await userEvent.click(screen.getByRole("button", { name: "create.finish" }));
    await waitFor(() => expect(mocks.routeStage).toHaveBeenCalledTimes(4));
    const ops = mocks.write.mock.calls.map((c) => c[1]);
    expect(ops[0].vehicle).toMatchObject({ kind: "motorhome" });
    const bookings = ops.filter((o) => o.collection === "bookings").map((o) => o.value);
    expect(bookings.map((b) => [b.title, b.estimate])).toEqual([
      ["Genova → Palermo", { amount: 320, currency: "EUR" }],
      ["Palermo → Genova", null],
    ]);
    const stages = ops.filter((o) => o.collection === "stages").map((o) => o.value);
    expect(stages.map((g) => g.mode)).toEqual(["drive", "ferry", "ferry", "drive"]);
    expect(stages[1].bookingId).toBe(bookings[0].id);
    // Every booking is written before the first stage that may name it.
    const lastBooking = ops.map((o) => o.collection).lastIndexOf("bookings");
    expect(ops.findIndex((o) => o.collection === "stages")).toBeGreaterThan(lastBooking);
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
