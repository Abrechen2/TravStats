import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import RoadtripCostsSection, { formatAmounts } from "../RoadtripCostsSection";
import { expensesApi } from "../../../lib/api/expenses";
import type { RoadtripCosts, TripExpense } from "../../../types/expense";
import type { RoadtripStation } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "from" in o ? `${k}:${String(o.from)}>${String(o.to)}` : k,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../../lib/api/expenses", () => ({
  expensesApi: {
    createForRoadtrip: vi.fn(async () => ({})),
    updateForRoadtrip: vi.fn(async () => ({})),
    removeForRoadtrip: vi.fn(async () => undefined),
  },
}));

const station = (id: string, title: string, state = "free"): RoadtripStation =>
  ({ id, title, state, lat: 1, lon: 1 }) as RoadtripStation;
const STATIONS = [
  station("hirtshals", "Hirtshals", "pass"),
  station("bend", "", "via"),
  station("lom", "Lom"),
];

const expense = (over: Partial<TripExpense>): TripExpense => ({
  id: "e1",
  tripId: null,
  routeId: "rt",
  stopId: null,
  legFromStopId: null,
  legToStopId: null,
  kind: "fuel",
  amount: 10,
  currency: "EUR",
  date: null,
  note: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

const NO_COSTS: RoadtripCosts = { total: {}, byStation: [], byLeg: [], unpinned: {} };

function renderSection(expenses: TripExpense[] = [], costs = NO_COSTS, onChanged = vi.fn()) {
  render(
    <RoadtripCostsSection
      roadtripId="rt"
      stations={STATIONS}
      expenses={expenses}
      costs={costs}
      onChanged={onChanged}
    />
  );
  return onChanged;
}

const axiosError = (status?: number) =>
  Object.assign(new Error("request failed"), {
    isAxiosError: true,
    response: status ? { status, data: {} } : undefined,
  });

describe("RoadtripCostsSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the total per currency, never added across currencies", () => {
    // Intl separates amount and symbol with a no-break space.
    const plain = (text: string | null) => (text ?? "").replace(/\u00a0/g, " ");
    expect(plain(formatAmounts({ NOK: 1290, EUR: 17.5 }, "de"))).toBe("17,5 € + 1.290 NOK");
    renderSection([expense({ amount: 17.5 })], { ...NO_COSTS, total: { NOK: 1290, EUR: 17.5 } });
    expect(plain(screen.getByTestId("roadtrip-costs-total").textContent)).toBe(
      "17,5 € + 1.290 NOK"
    );
  });

  it("says where each was paid: a station, a leg, the whole roadtrip, or a deleted station", () => {
    renderSection(
      [
        expense({ id: "a", stopId: "lom" }),
        expense({ id: "b", legFromStopId: "hirtshals", legToStopId: "lom" }),
        expense({ id: "c" }),
        expense({ id: "d", stopId: "gone" }),
      ],
      { ...NO_COSTS, total: { EUR: 40 } }
    );
    expect(screen.getByText("Lom")).toBeTruthy();
    expect(screen.getByText("roadtrips:costs.leg:Hirtshals>Lom")).toBeTruthy();
    expect(screen.getByText("roadtrips:costs.wholeTrip")).toBeTruthy();
    expect(screen.getByText("roadtrips:costs.removedStation")).toBeTruthy();
  });

  it("records a new cost at a station and reloads the page's figures", async () => {
    const onChanged = renderSection();
    fireEvent.click(screen.getByText("roadtrips:costs.add"));
    fireEvent.change(screen.getByLabelText("roadtrips:costs.dialog.kind"), {
      target: { value: "pitch" },
    });
    fireEvent.change(screen.getByLabelText("roadtrips:costs.dialog.amount"), {
      target: { value: "35,50" },
    });
    fireEvent.change(screen.getByLabelText("roadtrips:costs.dialog.date"), {
      target: { value: "2026-07-15" },
    });
    // A route correction is no place to pay at: it is not offered.
    const stationSelect = screen.getByLabelText("roadtrips:costs.dialog.station");
    expect(Array.from((stationSelect as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      "",
      "hirtshals",
      "lom",
    ]);
    fireEvent.change(stationSelect, { target: { value: "lom" } });
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(expensesApi.createForRoadtrip).toHaveBeenCalledWith("rt", {
      kind: "pitch",
      amount: 35.5,
      currency: "EUR",
      date: "2026-07-15",
      note: null,
      stopId: "lom",
      legFromStopId: null,
      legToStopId: null,
    });
  });

  it("keeps the dialog open and says the entry was refused on a 400", async () => {
    vi.mocked(expensesApi.createForRoadtrip).mockRejectedValueOnce(axiosError(400));
    const onChanged = renderSection();
    fireEvent.click(screen.getByText("roadtrips:costs.add"));
    fireEvent.change(screen.getByLabelText("roadtrips:costs.dialog.amount"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "roadtrips:costs.dialog.error.invalid"
    );
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText("roadtrips:costs.dialog.save")).toBeTruthy();
  });

  it("says the server is unreachable, not that the entry is wrong, on a network failure", async () => {
    vi.mocked(expensesApi.createForRoadtrip).mockRejectedValueOnce(axiosError());
    renderSection();
    fireEvent.click(screen.getByText("roadtrips:costs.add"));
    fireEvent.change(screen.getByLabelText("roadtrips:costs.dialog.amount"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "roadtrips:costs.dialog.error.unreachable"
    );
  });

  it("refuses to send an amount that is not a number", () => {
    renderSection();
    fireEvent.click(screen.getByText("roadtrips:costs.add"));
    fireEvent.change(screen.getByLabelText("roadtrips:costs.dialog.amount"), {
      target: { value: "zwölf" },
    });
    const save = screen.getByText("roadtrips:costs.dialog.save").closest("button");
    expect(save?.disabled).toBe(true);
    expect(screen.getByText("roadtrips:costs.dialog.amountInvalid")).toBeTruthy();
  });

  it("keeps a toll's leg when the edit names no station", async () => {
    const toll = expense({
      id: "toll",
      kind: "toll",
      amount: 12.5,
      legFromStopId: "hirtshals",
      legToStopId: "lom",
    });
    const onChanged = renderSection([toll], { ...NO_COSTS, total: { EUR: 12.5 } });
    fireEvent.click(screen.getByText("roadtrips:costs.kind.toll"));
    expect(screen.getByText("roadtrips:costs.dialog.keepLeg:Hirtshals>Lom")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("roadtrips:costs.dialog.amount"), {
      target: { value: "14" },
    });
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const body = vi.mocked(expensesApi.updateForRoadtrip).mock.calls[0][2];
    expect(body).toMatchObject({ amount: 14, stopId: null });
    expect(body).not.toHaveProperty("legFromStopId");
  });

  it("deletes from inside the edit dialog", async () => {
    const onChanged = renderSection([expense({ id: "x" })], { ...NO_COSTS, total: { EUR: 10 } });
    fireEvent.click(screen.getByText("roadtrips:costs.kind.fuel"));
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.delete"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(expensesApi.removeForRoadtrip).toHaveBeenCalledWith("rt", "x");
  });

  it("says so when nothing was recorded, instead of a zero total", () => {
    renderSection();
    expect(screen.getByText("roadtrips:costs.empty")).toBeTruthy();
    expect(screen.queryByTestId("roadtrip-costs-total")).toBeNull();
  });
});
