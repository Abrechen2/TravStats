import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import i18next from "i18next";
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
// Money is formatted by lib/format in the language the app speaks (ui-unify A).
beforeAll(async () => {
  await i18next.changeLanguage("de");
});
afterAll(async () => {
  await i18next.changeLanguage("en");
});

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
    expect(screen.getByText(/budgetRow\.estimated:150\s€/)).toBeInTheDocument();
    expect(screen.queryByText(/— EUR/)).toBeNull();
  });

  it("a booking shows its price as money", () => {
    setup();
    expect(screen.getByText(/180\s€/)).toBeInTheDocument();
  });
});
