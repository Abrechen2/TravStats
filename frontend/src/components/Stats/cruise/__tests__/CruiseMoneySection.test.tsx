import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

import type { Cruise } from "../../../../types/cruise";
import type { CruiseTotalSpendBase } from "../../../../lib/api/stats";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    // Keys are echoed with their interpolation, so a test can see WHICH string
    // was chosen and what it was handed without owning a copy of the German.
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}(${JSON.stringify(options)})`,
    i18n: { language: "de" },
  }),
}));

import { deriveCruiseStats } from "../../../../lib/stats/cruiseStatsDetail";
import { CruiseMoneySection } from "../CruiseDetailSections";

/**
 * The money section's one summed figure.
 *
 * The per-currency rows above it are folded from the cruise ROWS and are never
 * added together; the tile is a different figure arrived at a different way —
 * the server's `totalSpendBase`, which reads the FX snapshots. The three
 * things worth binding are that the tile shows the currency it is denominated
 * in, that it says out loud what it left out, and that it ABSTAINS with a dash
 * rather than printing a zero when nothing converted.
 *
 * The fourth is the trigger: `?evidence=metric:<key>` plus the scope is the
 * whole contract between a tile and the panel, and a tile wired to the wrong
 * key or to a different population looks identical to a correct one until it
 * is opened.
 */

const cruise = (over: Partial<Cruise> & { id: string }): Cruise =>
  ({
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "AIDA",
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: "2024-04-01",
    endDate: "2024-04-08",
    status: "flown",
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops: [],
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...over,
  }) as unknown as Cruise;

/** One euro cruise and one dollar one — the rows the section reports per currency. */
const detail = deriveCruiseStats([
  cruise({ id: "c1", price: 1200, currency: "EUR" }),
  cruise({ id: "c2", price: 900, currency: "USD" }),
]);

const LIFETIME = { period: "allTime" } as const;

function renderSection(
  totalSpendBase: CruiseTotalSpendBase | undefined,
  onSearch: (search: string) => void = () => {}
): void {
  render(
    <MemoryRouter>
      <CruiseMoneySection
        detail={detail}
        accent="var(--domain-cruise)"
        locale="de-DE"
        totalSpendBase={totalSpendBase}
        scope={LIFETIME}
      />
      <LocationProbe onChange={onSearch} />
    </MemoryRouter>
  );
}

/** `MemoryRouter` never touches `window.location`, so the search string has to be read from inside it. */
function LocationProbe({ onChange }: { onChange: (search: string) => void }): null {
  onChange(useLocation().search);
  return null;
}

describe("CruiseMoneySection base-currency total", () => {
  beforeEach(() => {
    cleanup();
  });

  it("shows the converted sum in the currency the server named", () => {
    renderSection({ value: 2030.55, excludedCount: 0, currency: "EUR" });
    const tile = screen.getByText("cruise:stats.money.baseTotal").parentElement;
    // `formatCurrency` keeps `minimumFractionDigits: 0`, so the separator is
    // all this can pin — the grouping one differs by locale and the language
    // is not mocked here.
    expect(tile?.textContent).toMatch(/2[.,]030[,.]55/);
    expect(tile?.textContent).toMatch(/€|EUR/);
  });

  it("names the cruises it had to leave out, and only when there are any", () => {
    renderSection({ value: 2030.55, excludedCount: 2, currency: "EUR" });
    expect(
      screen.getByText(/cruise:stats\.money\.baseTotalExcluded.*"count":2/)
    ).toBeInTheDocument();

    cleanup();
    renderSection({ value: 2030.55, excludedCount: 0, currency: "EUR" });
    expect(screen.queryByText(/baseTotalExcluded/)).not.toBeInTheDocument();
  });

  /** A zero would claim the sailing was free. The dash says nothing converted. */
  it("abstains with a dash and says why, rather than printing a zero", () => {
    renderSection({ value: null, excludedCount: 2, currency: "EUR" });
    const tile = screen.getByText("cruise:stats.money.baseTotal").parentElement;
    expect(tile?.textContent).toContain("—");
    expect(tile?.textContent).not.toMatch(/0[,.]00/);
    expect(screen.getByText(/cruise:stats\.money\.baseTotalNone.*EUR/)).toBeInTheDocument();
  });

  it("draws no tile at all when the backend answered for no such figure", () => {
    renderSection(undefined);
    expect(screen.queryByText("cruise:stats.money.baseTotal")).not.toBeInTheDocument();
    // The per-currency rows are unaffected — they come from the rows, not the rollup.
    expect(screen.getByText("cruise:stats.money.byCurrency")).toBeInTheDocument();
  });

  it("opens the evidence panel for cruiseTotalSpend, scoped to what it shows", async () => {
    let search = "";
    renderSection({ value: 2030.55, excludedCount: 1, currency: "EUR" }, (next) => {
      search = next;
    });
    const { useEvidenceOpenStore } = await import("../../../evidence/evidenceOpenStore");

    await act(async () => {
      screen.getByRole("button").click();
    });

    expect(new URLSearchParams(search).get("evidence")).toBe("metric:cruiseTotalSpend");
    expect(useEvidenceOpenStore.getState().scope).toEqual(LIFETIME);
    // The panel re-computes and compares against what the tile displayed, so
    // the figure travels in the measure's own unit — and an abstention would
    // travel as null rather than as a zero.
    expect(useEvidenceOpenStore.getState().renderedValue).toBe(2030.55);
  });
});
