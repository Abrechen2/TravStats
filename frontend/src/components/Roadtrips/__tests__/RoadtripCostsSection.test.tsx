import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RoadtripCostsSection, { formatAmounts } from "../RoadtripCostsSection";
import { expensesApi } from "../../../lib/api/expenses";
import { documentsApi } from "../../../lib/api/documents";
import { companionsApi } from "../../../lib/api/companions";
import { useToastStore } from "../../../store/toastStore";
import type { RoadtripCosts, TripExpense } from "../../../types/expense";
import type { RoadtripStation } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "from" in o
        ? `${k}:${String(o.from)}>${String(o.to)}`
        : o && "place" in o
          ? `${k}:${String(o.name)}@${String(o.place)}`
          : o && "amounts" in o
            ? `${k}:${String(o.amounts)}`
            : o && "amount" in o
              ? `${k}:${String(o.amount)}${"source" in o ? `|${String(o.source)}` : ""}`
              : k,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../../hooks/useTodayZone", () => ({ useTodayZone: () => "Europe/Berlin" }));
vi.mock("../../../lib/api/companions", () => ({
  companionsApi: { list: vi.fn(async () => [{ id: "c1", name: "Anna", usageCount: 3 }]) },
}));
// The receipt panel has its own suite; here it only has to be wired to the expense.
vi.mock("../../documents/DocumentsSection", () => ({
  default: ({ entry }: { entry: { type: string; id: string } }) => (
    <div data-testid="expense-documents">{`${entry.type}:${entry.id}`}</div>
  ),
}));
vi.mock("../../../lib/api/documents", () => ({
  documentsApi: { upload: vi.fn(async () => ({ id: "d1" })) },
}));
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
  payer: null,
  fx: null,
  documentCount: 0,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

const NO_COSTS: RoadtripCosts = {
  total: {},
  totalBase: { currency: "EUR", amount: 0, unconverted: {} },
  byStation: [],
  byLeg: [],
  unpinned: {},
};

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

/**
 * Open the dialog and let the payer picker's companion list arrive, so no
 * state update lands after a test's assertions (the act ratchet, forgejo#110).
 */
async function openDialog(trigger: string | RegExp): Promise<void> {
  fireEvent.click(screen.getByText(trigger));
  await screen.findByText("Anna");
}

const axiosError = (status?: number) =>
  Object.assign(new Error("request failed"), {
    isAxiosError: true,
    response: status ? { status, data: {} } : undefined,
  });

describe("RoadtripCostsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
  });

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
    await openDialog("roadtrips:costs.add");
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.kind/), {
      target: { value: "pitch" },
    });
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
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
    await openDialog("roadtrips:costs.add");
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "roadtrips:costs.dialog.error.invalid"
    );
    // A refusal of the input is not cured by pressing again: no retry offered.
    expect(screen.queryByRole("button", { name: "common:buttons.retry" })).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText("roadtrips:costs.dialog.save")).toBeTruthy();
  });

  it("says the server is unreachable, not that the entry is wrong, on a network failure", async () => {
    vi.mocked(expensesApi.updateForRoadtrip).mockRejectedValueOnce(axiosError());
    renderSection([expense({ id: "e" })], { ...NO_COSTS, total: { EUR: 10 } });
    await openDialog("roadtrips:costs.kind.fuel");
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
      target: { value: "11" },
    });
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "roadtrips:costs.dialog.error.unreachable"
    );
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(expensesApi.updateForRoadtrip).toHaveBeenCalledTimes(2));
  });

  // Bus review, Minor 2 (integration wiring): a NEW cost whose answer was lost
  // may be booked already; a retry here would book it twice.
  it("offers no retry when a new cost's answer was lost", async () => {
    vi.mocked(expensesApi.createForRoadtrip).mockRejectedValueOnce(axiosError());
    renderSection();
    await openDialog("roadtrips:costs.add");
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("common:saveErrors.outcomeUnknown");
    expect(screen.queryByRole("button", { name: "common:buttons.retry" })).toBeNull();
    expect(expensesApi.createForRoadtrip).toHaveBeenCalledTimes(1);
  });

  it("refuses to send an amount that is not a number", async () => {
    renderSection();
    await openDialog("roadtrips:costs.add");
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
      target: { value: "zwölf" },
    });
    const save = screen.getByText("roadtrips:costs.dialog.save").closest("button");
    expect(save?.disabled).toBe(true);
    const amount = screen.getByLabelText(/roadtrips:costs.dialog.amount/);
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(amount).toHaveAccessibleDescription("roadtrips:costs.dialog.amountInvalid");
    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent(
      "roadtrips:costs.dialog.amountMissingValid"
    );
  });

  // forgejo#245: the amount is marked as required and the greyed-out button
  // says that it is what is missing — no hover needed.
  it("marks the amount as required and names it beside the disabled button", async () => {
    renderSection();
    await openDialog("roadtrips:costs.add");
    const amount = screen.getByLabelText(/roadtrips:costs.dialog.amount/);
    expect(amount).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("common:form.requiredLegend")).toBeInTheDocument();
    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent(
      "roadtrips:costs.dialog.amount"
    );
    fireEvent.change(amount, { target: { value: "12" } });
    expect(screen.queryByTestId("save-blocked-hint")).not.toBeInTheDocument();
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
    await openDialog("roadtrips:costs.kind.toll");
    expect(screen.getByText("roadtrips:costs.dialog.keepLeg:Hirtshals>Lom")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
      target: { value: "14" },
    });
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const body = vi.mocked(expensesApi.updateForRoadtrip).mock.calls[0][2];
    // Only what changed, with the version it was read at: the leg (and every
    // field the phone might have changed meanwhile) is not sent back.
    expect(body).toEqual({ amount: 14, baseVersion: "2026-07-01T00:00:00.000Z" });
  });

  // forgejo#271: the phone edits expenses too; a full body would write the
  // opened values over its change.
  it("sends a station change as the station alone, and a note change as the note alone", async () => {
    const onChanged = renderSection([expense({ id: "e", note: "Diesel" })], {
      ...NO_COSTS,
      total: { EUR: 10 },
    });
    await openDialog(/roadtrips:costs.kind.fuel/);
    fireEvent.change(screen.getByLabelText("roadtrips:costs.dialog.station"), {
      target: { value: "lom" },
    });
    fireEvent.change(screen.getByLabelText("roadtrips:costs.dialog.note"), {
      target: { value: "Diesel, voll" },
    });
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(vi.mocked(expensesApi.updateForRoadtrip).mock.calls[0][2]).toEqual({
      stopId: "lom",
      legFromStopId: null,
      legToStopId: null,
      note: "Diesel, voll",
      baseVersion: "2026-07-01T00:00:00.000Z",
    });
  });

  it("says the cost changed elsewhere when the server holds a newer version", async () => {
    vi.mocked(expensesApi.updateForRoadtrip).mockRejectedValueOnce(
      Object.assign(new Error("conflict"), {
        isAxiosError: true,
        response: { status: 409, data: { code: "VERSION_CONFLICT" } },
      })
    );
    const onChanged = renderSection([expense({ id: "e" })], { ...NO_COSTS, total: { EUR: 10 } });
    await openDialog("roadtrips:costs.kind.fuel");
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
      target: { value: "11" },
    });
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "roadtrips:costs.dialog.error.conflict"
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("closes an unchanged edit without sending anything", async () => {
    renderSection([expense({ id: "e" })], { ...NO_COSTS, total: { EUR: 10 } });
    await openDialog("roadtrips:costs.kind.fuel");
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));
    await waitFor(() =>
      expect(screen.queryByText("roadtrips:costs.dialog.save")).not.toBeInTheDocument()
    );
    expect(expensesApi.updateForRoadtrip).not.toHaveBeenCalled();
  });

  // forgejo#250: deleting was one unconfirmed tap; now it names the cost that goes.
  it("asks before deleting and names the cost and where it was paid, then deletes", async () => {
    const onChanged = renderSection([expense({ id: "x", stopId: "lom", date: "2026-07-15" })], {
      ...NO_COSTS,
      total: { EUR: 10 },
    });
    await openDialog("roadtrips:costs.kind.fuel");
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.delete"));
    expect(expensesApi.removeForRoadtrip).not.toHaveBeenCalled();

    const confirm = await screen.findByTestId("confirm-modal");
    expect(confirm).toHaveTextContent(
      /roadtrips:costs.deleteConfirm.message:roadtrips:costs.kind.fuel · 10\s€ · 15\.07\.2026@Lom/
    );
    const button = screen.getByRole("button", { name: "roadtrips:costs.deleteConfirm.confirm" });
    expect(button.className).toContain("bg-[var(--danger)]");
    fireEvent.click(button);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    // With the version it was read at (review M8).
    expect(expensesApi.removeForRoadtrip).toHaveBeenCalledWith(
      "rt",
      "x",
      "2026-07-01T00:00:00.000Z"
    );
  });

  it("does not delete a cost the phone changed meanwhile, and says so", async () => {
    vi.mocked(expensesApi.removeForRoadtrip).mockRejectedValueOnce(
      Object.assign(new Error("conflict"), {
        isAxiosError: true,
        response: { status: 409, data: { code: "VERSION_CONFLICT" } },
      })
    );
    const onChanged = renderSection([expense({ id: "x" })], { ...NO_COSTS, total: { EUR: 10 } });
    await openDialog("roadtrips:costs.kind.fuel");
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.delete"));
    fireEvent.click(
      await screen.findByRole("button", { name: "roadtrips:costs.deleteConfirm.confirm" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "roadtrips:costs.dialog.error.conflict"
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("keeps the cost when the delete question is answered with cancel", async () => {
    renderSection([expense({ id: "x" })], { ...NO_COSTS, total: { EUR: 10 } });
    await openDialog("roadtrips:costs.kind.fuel");
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.delete"));
    const confirm = await screen.findByTestId("confirm-modal");
    fireEvent.click(
      Array.from(confirm.querySelectorAll("button")).find(
        (b) => b.textContent === "common:buttons.cancel"
      ) as HTMLElement
    );
    await waitFor(() => expect(screen.queryByTestId("confirm-modal")).not.toBeInTheDocument());
    expect(expensesApi.removeForRoadtrip).not.toHaveBeenCalled();
  });

  // forgejo#248
  it("asks before a typed amount is dismissed with Escape", async () => {
    renderSection();
    await openDialog("roadtrips:costs.add");
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
      target: { value: "12" },
    });
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
  });

  it("says so when nothing was recorded, instead of a zero total", () => {
    renderSection();
    expect(screen.getByText("roadtrips:costs.empty")).toBeTruthy();
    expect(screen.queryByTestId("roadtrip-costs-total")).toBeNull();
  });

  // forgejo#150 — categories, payer, rate, receipt.
  it("offers all thirteen categories", async () => {
    renderSection();
    await openDialog("roadtrips:costs.add");
    const kinds = screen.getByLabelText(/roadtrips:costs.dialog.kind/) as HTMLSelectElement;
    expect(Array.from(kinds.options).map((o) => o.value)).toEqual([
      "ferry",
      "toll",
      "pitch",
      "fuel",
      "charging",
      "parking",
      "transport",
      "food",
      "groceries",
      "activity",
      "shopping",
      "fees",
      "other",
    ]);
  });

  it("shows the server's base total, never adds what had no rate, and names it", () => {
    const plain = (text: string | null) => (text ?? "").replace(/\u00a0/g, " ");
    renderSection([expense({ amount: 17.5 })], {
      ...NO_COSTS,
      total: { EUR: 17.5, NOK: 1290, USD: 20 },
      // 17,50 € + 890 NOK at a recorded rate; 400 NOK and 20 USD had none.
      totalBase: { currency: "EUR", amount: 94.75, unconverted: { NOK: 400, USD: 20 } },
    });
    // The server's figure, as it sent it — not 17,50 + 1.290 + 20 added here.
    expect(plain(screen.getByTestId("roadtrip-costs-base").textContent)).toBe(
      "roadtrips:costs.base.total:94,75 €"
    );
    expect(plain(screen.getByTestId("roadtrip-costs-base-unconverted").textContent)).toMatch(
      /^roadtrips:costs.base.unconverted:400 NOK \+ 20/
    );
  });

  it("gives no base figure when nothing could be converted", () => {
    renderSection([expense({ currency: "NOK", amount: 1290 })], {
      ...NO_COSTS,
      total: { NOK: 1290 },
      totalBase: { currency: "EUR", amount: 0, unconverted: { NOK: 1290 } },
    });
    expect(screen.getByTestId("roadtrip-costs-base-none")).toBeInTheDocument();
    expect(screen.queryByTestId("roadtrip-costs-base")).toBeNull();
  });

  it("adds no base line when everything was paid in the base currency", () => {
    renderSection([expense({})], {
      ...NO_COSTS,
      total: { EUR: 10 },
      totalBase: { currency: "EUR", amount: 10, unconverted: {} },
    });
    expect(screen.queryByTestId("roadtrip-costs-base")).toBeNull();
    expect(screen.queryByTestId("roadtrip-costs-base-none")).toBeNull();
  });

  it("shows on each row who paid, that a receipt is filed, and the converted amount", () => {
    renderSection(
      [
        expense({
          currency: "NOK",
          amount: 890,
          payer: { companionId: "c1", name: "Anna" },
          documentCount: 2,
          fx: {
            amountBase: 77.25,
            rate: 0.0868,
            rateDate: "2026-07-14",
            baseCurrency: "EUR",
            source: "manual",
          },
        }),
      ],
      { ...NO_COSTS, total: { NOK: 890 } }
    );
    expect(screen.getByText(/roadtrips:costs.paidBy/)).toBeInTheDocument();
    expect(screen.getByTestId("expense-receipt")).toBeInTheDocument();
    // A typed rate is labelled as such, never as the ECB's.
    expect(
      screen.getByText(
        /^roadtrips:costs.fx.rowConverted:77,25.€\|roadtrips:costs.fx.source.manual$/
      )
    ).toBeInTheDocument();
  });

  it("records a companion as payer and a hand-typed rate on a new cost", async () => {
    const onChanged = renderSection();
    await openDialog("roadtrips:costs.add");
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText("roadtrips:costs.dialog.date"), {
      target: { value: "2026-07-15" },
    });
    // The rate block appears once the currency is not the base one.
    fireEvent.change(document.getElementById("expense-currency") as HTMLElement, {
      target: { value: "NOK" },
    });
    fireEvent.change(screen.getByLabelText("roadtrips:costs.payer.label"), {
      target: { value: "companion:c1" },
    });
    fireEvent.click(screen.getByText("roadtrips:costs.fx.enterManual"));
    fireEvent.change(screen.getByLabelText("roadtrips:costs.fx.manualLabel"), {
      target: { value: "0,087" },
    });
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(vi.mocked(expensesApi.createForRoadtrip).mock.calls[0][1]).toMatchObject({
      currency: "NOK",
      payer: { companionId: "c1" },
      fx: { rate: 0.087, rateDate: "2026-07-15", baseCurrency: "EUR", source: "manual" },
    });
  });

  it("blocks the save while a chosen free-text payer has no name", async () => {
    renderSection();
    await openDialog("roadtrips:costs.add");
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("roadtrips:costs.payer.label"), {
      target: { value: "name" },
    });
    expect(screen.getByText("roadtrips:costs.dialog.save").closest("button")?.disabled).toBe(true);
    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent(
      "roadtrips:costs.payer.missing"
    );
  });

  it("says the companions could not be loaded, and still takes a typed name", async () => {
    vi.mocked(companionsApi.list).mockRejectedValueOnce(new Error("down"));
    renderSection();
    fireEvent.click(screen.getByText("roadtrips:costs.add"));
    expect(await screen.findByText("roadtrips:costs.payer.loadFailed")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:costs.payer.other")).toBeTruthy();
  });

  it("tells the reader when no exchange rate could be found for a saved cost", async () => {
    vi.mocked(expensesApi.updateForRoadtrip).mockResolvedValueOnce({
      expense: expense({ id: "e", currency: "NOK" }),
      fxSnapshot: "lookupFailed",
    });
    const onChanged = renderSection([expense({ id: "e", currency: "NOK" })], {
      ...NO_COSTS,
      total: { NOK: 10 },
    });
    await openDialog("roadtrips:costs.kind.fuel");
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
      target: { value: "11" },
    });
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        type: "warning",
        message: "roadtrips:costs.fx.outcome.lookupFailed",
      }),
    ]);
  });

  it("removes a stored rate with an explicit null, and shows where it came from first", async () => {
    const withRate = expense({
      id: "e",
      currency: "NOK",
      fx: {
        amountBase: 0.87,
        rate: 0.087,
        rateDate: "2026-07-14",
        baseCurrency: "EUR",
        source: "ecb",
      },
    });
    const onChanged = renderSection([withRate], { ...NO_COSTS, total: { NOK: 10 } });
    await openDialog("roadtrips:costs.kind.fuel");
    expect(screen.getByTestId("expense-fx-recorded")).toHaveTextContent(
      /roadtrips:costs.fx.recorded:0,87.€\|roadtrips:costs.fx.source.ecb/
    );
    fireEvent.click(screen.getByText("roadtrips:costs.fx.remove"));
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(vi.mocked(expensesApi.updateForRoadtrip).mock.calls[0][2]).toEqual({
      fx: null,
      baseVersion: "2026-07-01T00:00:00.000Z",
    });
  });

  it("files receipts on a saved cost, and promises them after saving for a new one", async () => {
    renderSection([expense({ id: "e" })], { ...NO_COSTS, total: { EUR: 10 } });
    await openDialog("roadtrips:costs.kind.fuel");
    expect(screen.getByTestId("expense-documents")).toHaveTextContent("tripExpense:e");
  });

  const created = (id: string) => ({ expense: expense({ id }), fxSnapshot: "undated" as const });
  const pickReceipt = (): File => {
    const file = new File(["%PDF"], "beleg.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("roadtrips:costs.receipt.pick"), {
      target: { files: [file] },
    });
    return file;
  };

  it("a new cost takes a receipt that goes up once the cost is saved", async () => {
    vi.mocked(expensesApi.createForRoadtrip).mockResolvedValueOnce(created("new1"));
    const onChanged = renderSection();
    await openDialog("roadtrips:costs.add");
    expect(screen.queryByTestId("expense-documents")).toBeNull();
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
      target: { value: "12" },
    });
    const file = pickReceipt();
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(documentsApi.upload).toHaveBeenCalledWith({
      entry: { type: "tripExpense", id: "new1" },
      file,
    });
  });

  it("a receipt that fails after the cost was saved is named, keeps the cost, and can be retried", async () => {
    vi.mocked(expensesApi.createForRoadtrip).mockResolvedValueOnce(created("new2"));
    vi.mocked(documentsApi.upload).mockRejectedValueOnce(new Error("offline"));
    const onChanged = renderSection();
    await openDialog("roadtrips:costs.add");
    fireEvent.change(screen.getByLabelText(/roadtrips:costs.dialog.amount/), {
      target: { value: "12" },
    });
    pickReceipt();
    fireEvent.click(screen.getByText("roadtrips:costs.dialog.save"));

    expect(await screen.findByTestId("expense-receipt-failed")).toHaveTextContent(
      "roadtrips:costs.receipt.attachFailed"
    );
    // The cost is not sent again, and the save is not reported as failed.
    expect(expensesApi.createForRoadtrip).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("roadtrips:costs.receipt.retry"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(documentsApi.upload).toHaveBeenLastCalledWith(
      expect.objectContaining({ entry: { type: "tripExpense", id: "new2" } })
    );
    expect(expensesApi.createForRoadtrip).toHaveBeenCalledTimes(1);
  });
});
