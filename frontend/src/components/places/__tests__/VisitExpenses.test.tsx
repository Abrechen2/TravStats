import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VisitExpenses } from "../VisitExpenses";
import { expensesApi } from "../../../lib/api/expenses";

vi.mock("../../../lib/api/expenses", () => ({ expensesApi: { forVisit: vi.fn() } }));

const expense = (id: string, amount: number, currency: string) => ({
  id,
  kind: "other",
  amount,
  currency,
  note: null,
});

describe("VisitExpenses (forgejo#429)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows each cost in its own currency and never one summed figure", async () => {
    vi.mocked(expensesApi.forVisit).mockResolvedValue({
      expenses: [expense("a", 18, "EUR"), expense("b", 100, "NOK")] as never,
      totals: { EUR: 18, NOK: 100 },
    });
    render(<VisitExpenses visitId="v1" />);
    const block = await screen.findByTestId("visit-expenses");
    expect(block.textContent).toMatch(/18/);
    expect(block.textContent).toMatch(/NOK|kr/);
    expect(block.textContent).toContain("+");
  });

  it("says so when the costs cannot be loaded instead of showing nothing", async () => {
    vi.mocked(expensesApi.forVisit).mockRejectedValue(new Error("boom"));
    render(<VisitExpenses visitId="v1" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });

  it("renders nothing for a visit without costs", async () => {
    vi.mocked(expensesApi.forVisit).mockResolvedValue({ expenses: [], totals: {} });
    const { container } = render(<VisitExpenses visitId="v1" />);
    await waitFor(() => expect(expensesApi.forVisit).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
