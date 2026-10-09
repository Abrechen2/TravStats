/**
 * forgejo#238 at the form: a deposit is held at the counter (Abholung) and
 * comes back later (Rückgabe), in its own currency, possibly in part — and
 * it travels in its own keys, never as a price.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => null }));
// Kept fast under a loaded host (re-review, fix round 3): the real currency
// select lists every ISO code, three times over with all steps mounted, and
// every keystroke re-renders them. What this suite checks is the deposit's
// own keys, so a plain select stands in, and the station pickers are inert.
vi.mock("../../common/CurrencySelect", () => ({
  default: ({
    id,
    value,
    onChange,
    "aria-label": label,
  }: {
    id?: string;
    value: string;
    onChange: (code: string) => void;
    "aria-label"?: string;
  }) => (
    <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="EUR">EUR</option>
      <option value="USD">USD</option>
    </select>
  ),
}));
vi.mock("../RentalStationPicker", () => ({ RentalStationPicker: () => null }));

const update = vi.fn();
vi.mock("../../../lib/api/rental", () => ({
  rentalApi: {
    create: vi.fn(),
    update: (...a: unknown[]) => update(...a),
    searchStations: vi.fn().mockResolvedValue([]),
  },
}));

import { RentalFormModal } from "../RentalFormModal";
import { makeRental } from "./rentalFixture";

// By id and text, not by role: role queries walk the accessibility tree of
// all three mounted steps on every call.
const tab = (step: string): HTMLElement =>
  document.getElementById(`rental-form-step-${step}`) as HTMLElement;
const panel = (step: string): HTMLElement =>
  document.getElementById(`rental-form-panel-${step}`) as HTMLElement;
const save = (): HTMLElement => screen.getByText("rental:form.save");

describe("rental deposit in the form", () => {
  beforeEach(() => update.mockReset().mockResolvedValue(makeRental()));

  it("records a deposit held in another currency and a partial refund, in its own keys", async () => {
    render(
      <RentalFormModal
        rental={makeRental({ price: 100, currency: "EUR" })}
        initialStep="pickup"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    fireEvent.change(within(panel("pickup")).getByLabelText("rental:form.depositAmount"), {
      target: { value: "300" },
    });
    fireEvent.change(within(panel("pickup")).getByLabelText("rental:form.depositCurrency"), {
      target: { value: "USD" },
    });
    fireEvent.change(within(panel("pickup")).getByLabelText("rental:form.depositPaidOn"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.click(tab("return"));
    fireEvent.change(within(panel("return")).getByLabelText("rental:form.depositReturnedOn"), {
      target: { value: "2026-07-12" },
    });
    fireEvent.change(within(panel("return")).getByLabelText("rental:form.depositReturnedAmount"), {
      target: { value: "250" },
    });
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toMatchObject({
      depositAmount: 300,
      depositCurrency: "USD",
      depositPaidOn: "2026-07-01",
      depositReturnedOn: "2026-07-12",
      depositReturnedAmount: 250,
    });
    // The price is untouched by the deposit — not even re-sent (review I4).
    expect("price" in update.mock.calls[0][1]).toBe(false);
  });

  it("refuses more back than was held at that field, on the return step", async () => {
    render(
      <RentalFormModal
        rental={makeRental({ depositAmount: 300, depositCurrency: "USD" })}
        initialStep="booking"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    fireEvent.click(tab("return"));
    fireEvent.change(within(panel("return")).getByLabelText("rental:form.depositReturnedAmount"), {
      target: { value: "301" },
    });
    fireEvent.click(tab("booking"));
    fireEvent.click(save());
    const field = await within(panel("return")).findByLabelText(
      "rental:form.depositReturnedAmount"
    );
    expect(tab("return").getAttribute("aria-selected")).toBe("true");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(update).not.toHaveBeenCalled();
  });
});
