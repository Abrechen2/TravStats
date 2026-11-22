import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { Table, type TableColumn } from "../../ui/Table";
import { TOUR_COLUMN_IDS, TOUR_COLUMN_LAYOUT, TourTableRow } from "../TourTableRow";
import type { TourSummary } from "../../../lib/api/tourIndex";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const columns: TableColumn[] = TOUR_COLUMN_IDS.map((id) => ({
  key: id,
  label: id,
  ...TOUR_COLUMN_LAYOUT[id],
}));

const tour = (purpose: string | null): TourSummary =>
  ({
    id: "t1",
    tripId: null,
    tripName: null,
    name: "Stadtlauf",
    mode: "foot",
    kind: "tour",
    activity: null,
    vehicle: null,
    kindAssignedAutomatically: false,
    purpose,
    notes: null,
    anchorStopId: null,
    anchorStopTitle: null,
    distanceKm: 5,
    distanceSource: "legs",
    ascentM: null,
    movingSeconds: null,
    trackCount: 0,
    stopCount: 2,
  }) as unknown as TourSummary;

const renderRow = (purpose: string | null): void => {
  render(
    <Table columns={columns} label="Touren">
      <TourTableRow tour={tour(purpose)} columns={columns} onOpen={() => undefined} />
    </Table>
  );
};

describe("TourTableRow purpose", () => {
  it("a business tour carries the purpose chip", () => {
    renderRow("business");
    expect(screen.getByTestId("purpose-chip")).toBeInTheDocument();
  });
  it("a private or unknown tour carries none", () => {
    renderRow(null);
    expect(screen.queryByTestId("purpose-chip")).toBeNull();
  });
});
