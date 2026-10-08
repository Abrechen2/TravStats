/**
 * The rental form as three steps over one draft (forgejo#236) and its share of
 * the shared form blocks (forgejo#245–#249). Before: one long body, no marks,
 * red lines tied to nothing, the save request and the list reload in one try
 * (a failed reload read as "not saved" and invited a second create), and
 * Escape dropped a half-typed rental without a word.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => null }));

const create = vi.fn();
const update = vi.fn();
vi.mock("../../../lib/api/rental", () => ({
  rentalApi: {
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    searchStations: vi.fn().mockResolvedValue([]),
  },
}));

import { RentalFormModal } from "../RentalFormModal";
import { makeRental } from "./rentalFixture";

const tab = (step: "booking" | "pickup" | "return"): HTMLElement =>
  screen.getByRole("tab", { name: new RegExp(`^rental:form\\.steps\\.${step}`) });
const save = (): HTMLElement => screen.getByRole("button", { name: "rental:form.save" });
const networkError = { isAxiosError: true, code: "ERR_NETWORK", message: "Network Error" };

describe("RentalFormModal — steps and form blocks", () => {
  beforeEach(() => {
    create.mockReset();
    update.mockReset();
  });

  it("marks the required fields and explains the mark", () => {
    render(<RentalFormModal rental={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText(/^rental:form\.provider/).getAttribute("aria-required")).toBe(
      "true"
    );
    expect(screen.getByLabelText(/^rental:form\.pickupStation/).getAttribute("aria-required")).toBe(
      "true"
    );
    expect(
      screen.getByLabelText(/^rental:form\.pickupLocal\s*\*?$/).getAttribute("aria-required")
    ).toBe("true");
    expect(screen.getByText("common:form.requiredLegend")).toBeInTheDocument();
  });

  it("keeps every entry when switching steps, and saves them together", async () => {
    update.mockResolvedValue(makeRental());
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^rental:form\.broker/), {
      target: { value: "Holiday Cars" },
    });
    fireEvent.click(tab("pickup"));
    fireEvent.change(screen.getByLabelText("rental:form.licensePlate"), {
      target: { value: "F-TS 1" },
    });
    fireEvent.click(tab("return"));
    fireEvent.change(screen.getByLabelText("rental:form.odometerInKm"), {
      target: { value: "1200" },
    });
    fireEvent.click(tab("booking"));
    expect(screen.getByLabelText<HTMLInputElement>(/^rental:form\.broker/).value).toBe(
      "Holiday Cars"
    );
    fireEvent.click(tab("pickup"));
    expect(screen.getByLabelText<HTMLInputElement>("rental:form.licensePlate").value).toBe(
      "F-TS 1"
    );
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toMatchObject({
      broker: "Holiday Cars",
      licensePlate: "F-TS 1",
      odometerInKm: 1200,
    });
  });

  it("leads the return step with the odometer, the actual return time and the invoice", () => {
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(tab("return"));
    const panel = screen.getByRole("tabpanel");
    const labels = Array.from(panel.querySelectorAll("label, legend")).map((l) => l.textContent);
    const at = (text: string): number => labels.findIndex((l) => l?.startsWith(text));
    expect(at("rental:form.odometerInKm")).toBeGreaterThanOrEqual(0);
    expect(at("rental:form.odometerInKm")).toBeLessThan(at("rental:form.actualReturnLocal"));
    expect(at("rental:form.actualReturnLocal")).toBeLessThan(at("rental:form.invoice"));
    expect(at("rental:form.invoice")).toBeLessThan(at("rental:form.distanceKm"));
  });

  it("opens a rental that has been picked up at its return step", () => {
    render(
      <RentalFormModal
        rental={makeRental({ status: "completed" })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(tab("return").getAttribute("aria-selected")).toBe("true");
  });

  it("takes a refused save to the first gap on its own step, and counts the gaps per step", async () => {
    render(<RentalFormModal rental={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(tab("return"));
    fireEvent.click(save());
    const provider = await screen.findByLabelText(/^rental:form\.provider/);
    expect(tab("booking").getAttribute("aria-selected")).toBe("true");
    expect(provider.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(provider));
    expect(screen.getByTestId("rental-step-gaps-booking")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("puts the server's actual-order refusal at the actual return, on the return step", async () => {
    update.mockRejectedValue({
      response: {
        status: 400,
        data: { code: "RENTAL_ACTUAL_RETURN_BEFORE_PICKUP", field: "actualReturnLocal" },
      },
    });
    render(
      <RentalFormModal
        rental={makeRental()}
        initialStep="booking"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    fireEvent.click(save());
    const field = await screen.findByLabelText(/^rental:form\.actualReturnLocal\s*$/);
    expect(tab("return").getAttribute("aria-selected")).toBe("true");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("rental:form.errors.actualReturnBeforePickup")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it("keeps the draft on a network failure, says so in a banner, and retries once more", async () => {
    update.mockRejectedValueOnce(networkError).mockResolvedValueOnce(makeRental());
    const onSaved = vi.fn();
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/^rental:form\.broker/), {
      target: { value: "Holiday Cars" },
    });
    fireEvent.click(save());
    const banner = await screen.findByText("common:saveErrors.network");
    expect(banner.closest("[role=alert]")).not.toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>(/^rental:form\.broker/).value).toBe(
      "Holiday Cars"
    );
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("clears the banner on the next edit", async () => {
    update.mockRejectedValue(networkError);
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(save());
    await screen.findByText("common:saveErrors.network");
    fireEvent.change(screen.getByLabelText(/^rental:form\.broker/), { target: { value: "x" } });
    expect(screen.queryByText("common:saveErrors.network")).toBeNull();
  });

  it("sends one request for a double click", async () => {
    let finish: (v: unknown) => void = () => undefined;
    update.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={vi.fn()} />);
    const button = save();
    fireEvent.click(button);
    fireEvent.click(button);
    finish(makeRental());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it("shows the after-save notice instead of a second save when the reload fails", async () => {
    update.mockResolvedValue(makeRental());
    const onSaved = vi.fn().mockRejectedValue(new Error("reload failed"));
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(save());
    expect(await screen.findByText("common:form.savedButRefreshFailed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "rental:form.save" })).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("asks before Escape drops a changed form, and closes an unchanged one at once", async () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <RentalFormModal rental={makeRental()} onClose={onClose} onSaved={vi.fn()} />
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    onClose.mockReset();
    render(<RentalFormModal rental={makeRental()} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^rental:form\.broker/), { target: { value: "x" } });
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("common:discard.title")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "common:discard.confirm" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not ask about an edit form that was only looked through", async () => {
    const onClose = vi.fn();
    render(
      <RentalFormModal
        rental={makeRental({
          finalAmount: 150,
          finalCurrency: "EUR",
          finalAmountSource: "invoice",
          fuelPolicy: "full_to_full",
        })}
        onClose={onClose}
        onSaved={vi.fn()}
      />
    );
    fireEvent.click(tab("pickup"));
    fireEvent.click(tab("return"));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("records an actual return as a day, and in the repeated hour as the later one when asked", async () => {
    update.mockResolvedValue(makeRental());
    render(
      <RentalFormModal
        rental={makeRental({ status: "completed" })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    const actual = screen.getByLabelText(/^rental:form\.actualReturnLocal\s*$/);
    fireEvent.change(actual, { target: { value: "2026-10-25T02:30" } });
    // Berlin's clock showed 02:30 twice that night: the notice offers the later one.
    fireEvent.click(screen.getByLabelText("common:clockChange.later"));
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toMatchObject({
      actualReturnLocal: "2026-10-25T02:30",
      actualReturnFold: "later",
    });
  });

  it("saves a day-only actual return as the day", async () => {
    update.mockResolvedValue(makeRental());
    render(
      <RentalFormModal
        rental={makeRental({ status: "completed" })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText(/^rental:form\.actualReturnLocal\s*$/), {
      target: { value: "2026-07-05T09:40" },
    });
    fireEvent.click(screen.getByLabelText("rental:form.actualReturnLocal: rental:form.dayOnly"));
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toMatchObject({
      actualReturnLocal: "2026-07-05",
      actualReturnFold: null,
    });
  });

  it("leaves an invoice's final amount alone unless it is changed", async () => {
    update.mockResolvedValue(makeRental());
    const rental = makeRental({
      status: "completed",
      finalAmount: 150,
      finalCurrency: "EUR",
      finalAmountSource: "invoice",
    });
    const { unmount } = render(
      <RentalFormModal rental={rental} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect("finalAmount" in update.mock.calls[0][1]).toBe(false);
    unmount();
    render(<RentalFormModal rental={rental} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("rental:form.finalAmount"), {
      target: { value: "162,50" },
    });
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1]).toMatchObject({ finalAmount: 162.5, finalCurrency: "EUR" });
  });

  it("gives the station name a visible label in address mode", () => {
    render(<RentalFormModal rental={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getAllByText("rental:station.useAddress")[0]);
    const name = screen.getByLabelText(/rental:form\.pickupStation: rental:form\.stationName/);
    expect(name.getAttribute("placeholder")).toBeNull();
    expect(name.getAttribute("aria-required")).toBe("true");
  });
});
