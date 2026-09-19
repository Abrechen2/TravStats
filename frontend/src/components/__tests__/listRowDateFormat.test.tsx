import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { CruiseRow } from "../Cruise/CruiseRow";
import { LodgingRow } from "../lodging/LodgingRow";
import type { TableColumn } from "../ui/Table";
import type { Cruise } from "../../types/cruise";
import type { Lodging } from "../../types/lodging";

/**
 * Alex 10, beta audit 2026-09-19: the flight list, the passport panel and the
 * lodging DETAIL page obey the chosen date format, while the `/lodging` and
 * `/cruises` list tables printed raw ISO days — "2027-06-09" and
 * "2027-03-11 – 2027-03-18" — whatever the setting said. One app, two date
 * formats, one of them chosen by nobody.
 *
 * The suite fixes the preference at DD.MM.JJJJ (`src/__tests__/setup.ts`), so
 * an ISO day in either cell is exactly the defect.
 */
const dateColumn = (key: string): TableColumn[] => [{ key, label: key, min: 100 }];

describe("the list tables print the reader's date format", () => {
  it("shows a cruise's span as 11.03.2027 – 18.03.2027, not as ISO days", () => {
    const cruise = {
      id: "c1",
      startDate: "2027-03-11T00:00:00.000Z",
      endDate: "2027-03-18T00:00:00.000Z",
      stops: [],
      ship: null,
      shipNameOverride: null,
      cruiseLine: null,
      price: null,
      currency: "EUR",
    } as unknown as Cruise;

    render(
      <MemoryRouter>
        <CruiseRow
          cruise={cruise}
          onOpen={vi.fn()}
          actions={undefined}
          columns={dateColumn("dates")}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("11.03.2027 – 18.03.2027")).toBeInTheDocument();
    expect(screen.queryByText(/2027-03-11/)).not.toBeInTheDocument();
  });

  it("shows a lodging's newest stay as 09.06.2027, not as an ISO day", () => {
    const lodging = {
      id: "l1",
      name: "Hotel Gracery",
      chain: null,
      city: "Tokyo",
      country: "Japan",
      stayCount: 1,
      nights: 2,
      overallRating: null,
      totalSpendBase: 0,
      totalSpendBaseByCurrency: {},
      visited: true,
      stays: [
        {
          id: "s1",
          checkIn: "2027-06-09T00:00:00.000Z",
          checkOut: "2027-06-11T00:00:00.000Z",
          datePrecision: "DAY",
          nights: 2,
          status: "scheduled",
        },
      ],
    } as unknown as Lodging;

    render(
      <MemoryRouter>
        <LodgingRow
          lodging={lodging}
          baseCurrency="EUR"
          onOpen={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          columns={dateColumn("lastStay")}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("09.06.2027")).toBeInTheDocument();
    expect(screen.queryByText(/2027-06-09/)).not.toBeInTheDocument();
  });
});
