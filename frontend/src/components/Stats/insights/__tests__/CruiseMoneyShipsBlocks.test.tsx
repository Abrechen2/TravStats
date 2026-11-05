import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { CruiseInsights, CruiseRef } from "../../../../types/cruiseInsights";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));

import CruiseMoneyBlock from "../CruiseMoneyBlock";
import CruiseShipsBlock from "../CruiseShipsBlock";

const a: CruiseRef = { id: "c-a", label: "Nordland", startDate: "2023-05-01" };
const b: CruiseRef = { id: "c-b", label: "Karibik", startDate: "2024-05-01" };

const money = (over: Partial<CruiseInsights["money"]>): CruiseInsights["money"] => ({
  currency: "EUR",
  cruises: 3,
  unknownPrice: 1,
  excluded: 1,
  counted: 1,
  total: 900,
  perSeaDay: { amount: 150, seaDays: 6, cruises: [a] },
  mostExpensive: { cruise: a, amount: 900 },
  perLine: [{ line: "AIDA", total: 900, cruises: [a] }],
  ...over,
});

const ships = (over: Partial<CruiseInsights["ships"]>): CruiseInsights["ships"] => ({
  cruises: 3,
  biggest: { shipName: "Big", grossTonnage: 180000, capacity: 5000, yearBuilt: 2020, cruises: [b] },
  tonnageKnown: 1,
  averageAge: { years: 4, cruises: [b] },
  ageKnown: 1,
  ...over,
});

const wrap = (ui: JSX.Element) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("cruise money block", () => {
  it("links the cruises behind each figure and states the coverage incl. excluded currencies", () => {
    wrap(<CruiseMoneyBlock money={money({})} />);
    const links = screen.getAllByRole("link", { name: "Nordland" });
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(links[0].getAttribute("href")).toBe("/cruises/c-a");
    expect(screen.getByText(/stats:insights.cruise.money.coverage.*"excluded":"1"/)).toBeTruthy();
  });

  it("is hidden when no price reached the base currency", () => {
    const { container } = wrap(
      <CruiseMoneyBlock
        money={money({
          counted: 0,
          total: null,
          perSeaDay: null,
          mostExpensive: null,
          perLine: [],
        })}
      />
    );
    expect(container.textContent).toBe("");
  });
});

describe("cruise ships block", () => {
  it("states 'from n of m cruises' and links the cruise behind the biggest ship", () => {
    wrap(<CruiseShipsBlock ships={ships({})} />);
    expect(screen.getAllByRole("link", { name: "Karibik" })[0].getAttribute("href")).toBe(
      "/cruises/c-b"
    );
    expect(screen.getByText(/coverageTonnage.*"known":"1".*"cruises":"3"/)).toBeTruthy();
  });

  it("is hidden when the catalogue holds neither tonnage nor build year", () => {
    const { container } = wrap(
      <CruiseShipsBlock
        ships={ships({ biggest: null, averageAge: null, tonnageKnown: 0, ageKnown: 0 })}
      />
    );
    expect(container.textContent).toBe("");
  });

  it("shows the age alone when only the build year is known", () => {
    wrap(<CruiseShipsBlock ships={ships({ biggest: null, tonnageKnown: 0 })} />);
    expect(screen.queryByText(/ships.biggest\b/)).toBeNull();
    expect(screen.getByText(/ships.averageAge/)).toBeTruthy();
  });
});
