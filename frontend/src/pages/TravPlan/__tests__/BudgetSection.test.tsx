import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetSection } from "../sections/BudgetSection";
import type { PlanCtx } from "../planContext";
import { routePlan } from "../route/__tests__/routeFixture";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(",")}` : key,
  }),
}));
vi.mock("../../../lib/units", async (orig) => ({
  ...(await orig<object>()),
  appLocale: () => "de-DE",
}));

function setup() {
  const plan = routePlan();
  const ctx = {
    plan,
    state: plan.state,
    busy: false,
    edit: vi.fn(),
    mutate: vi.fn(),
  } as unknown as PlanCtx;
  render(<BudgetSection ctx={ctx} />);
}

describe("BudgetSection", () => {
  it("a placeholder shows its estimate as estimated, not as an empty price", () => {
    setup();
    expect(screen.getByText(/budgetRow\.estimated:150,00\s€/)).toBeInTheDocument();
    expect(screen.queryByText(/— EUR/)).toBeNull();
  });

  it("a booking shows its price as money", () => {
    setup();
    expect(screen.getByText(/180,00\s€/)).toBeInTheDocument();
  });
});
