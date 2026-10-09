import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
    ready: true,
  }),
}));

import RentalStatsDetails from "../RentalStatsDetails";
import type { RentalExtraStats, RentalStats } from "../../../../lib/api/rentalLinks";

/**
 * forgejo#262 — the rental blocks draw the server's figures, abstain with a
 * sentence that names the missing data, and never call a car an upgrade.
 */
const STATS: RentalStats = {
  rentals: 3,
  days: 9,
  oneWay: 1,
  byYear: [{ year: 2025, rentals: 3, days: 9 }],
  providers: [{ provider: "Sixt", rentals: 3, days: 9 }],
  brokers: [{ broker: "Check24", rentals: 2 }],
  countries: ["PT"],
  costPerDay: [],
  km: { total: 600, covered: 2, of: 3 },
  cancellationFees: [],
};

const EXTRA: RentalExtraStats = {
  brokered: { viaBroker: 2, direct: 1 },
  kmPerDay: { value: 100, rentals: 2, km: 600, days: 6 },
  costPerKm: [],
  bookedVsFinal: { byCurrency: [], otherCurrency: 1 },
  vehicles: {
    distinctDriven: 2,
    withDriven: 2,
    classes: [{ label: "Compact", rentals: 2 }],
    promisedVsDriven: { compared: 2, sameModel: 1, otherModel: 1 },
  },
  records: {
    longest: { id: "4b0c5c7e-7e53-4d8c-8d67-0b2b9e1e1a11", days: 5, provider: "Sixt" },
    farthest: null,
    newProviders: ["Sixt"],
  },
  odometerDocumented: 2,
};

const visibility = { isVisible: () => true, toggle: vi.fn(), reset: vi.fn(), hiddenCount: 0 };
const evidence = (key: string, renderedValue: number) => ({
  kind: "metric" as const,
  key,
  scope: { period: "allTime" as const },
  renderedValue,
});

function draw(extra: RentalExtraStats = EXTRA) {
  return render(
    <MemoryRouter>
      <RentalStatsDetails
        stats={STATS}
        extra={extra}
        accent="green"
        visibility={visibility}
        evidence={evidence}
      />
    </MemoryRouter>
  );
}

describe("RentalStatsDetails", () => {
  it("shows one-way rentals and brokers apart from providers", () => {
    draw();
    const block = screen.getByTestId("rental-brokers");
    expect(within(block).getByRole("heading", { name: "rental:stats.oneWay" })).toBeInTheDocument();
    expect(within(block).getByText("Check24")).toBeInTheDocument();
    expect(within(block).getByText('rental:stats.directDesc {"count":1}')).toBeInTheDocument();
  });

  it("names the subset km per day stands on, and abstains on cost per km", () => {
    draw();
    const block = screen.getByTestId("rental-efficiency");
    expect(within(block).getByText(/rental:stats.kmPerDaySample/).textContent).toContain(
      '"count":2'
    );
    expect(within(block).getByText("rental:stats.costPerKmNone")).toBeInTheDocument();
  });

  it("explains what enables booked-vs-billed, and that another currency stays out", () => {
    draw();
    const block = screen.getByTestId("rental-billing");
    expect(within(block).getByText("rental:stats.bookedVsFinalNone")).toBeInTheDocument();
    expect(
      within(block).getByText('rental:stats.bookedVsFinalOtherCurrency {"count":1}')
    ).toBeInTheDocument();
  });

  it("compares the promised and driven car neutrally — nothing says upgrade", () => {
    const { container } = draw();
    expect(screen.getByTestId("rental-vehicles").textContent).toContain("1 / 2");
    expect(container.textContent?.toLowerCase()).not.toContain("upgrade");
  });

  it("links the longest rental and abstains on an unknown farthest distance", () => {
    draw();
    const block = screen.getByTestId("rental-records");
    expect(within(block).getByRole("link")).toHaveAttribute(
      "href",
      "/rentals/4b0c5c7e-7e53-4d8c-8d67-0b2b9e1e1a11"
    );
    expect(within(block).getByText("rental:stats.farthestNone")).toBeInTheDocument();
  });
});
