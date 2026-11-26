import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Table, type TableColumn } from "../../ui/Table";
import { ROADTRIP_COLUMN_IDS, ROADTRIP_COLUMN_LAYOUT, RoadtripTableRow } from "../RoadtripTableRow";
import type { RoadtripPhase } from "../../../lib/roadtrip/roadtripView";
import type { RoadtripSummary } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const columns: TableColumn[] = ROADTRIP_COLUMN_IDS.map((id) => ({
  key: id,
  label: id,
  ...ROADTRIP_COLUMN_LAYOUT[id],
}));

function summary(over: Partial<RoadtripSummary>): RoadtripSummary {
  return {
    id: "rt-1",
    kind: "roadtrip",
    tripId: null,
    tripName: null,
    name: "QA Roadtrip",
    mode: "car",
    color: null,
    vehicle: "campervan",
    vehicleName: null,
    kindAssignedAutomatically: false,
    startDate: "2026-10-03T00:00:00.000Z",
    endDate: "2026-10-05T00:00:00.000Z",
    distanceKm: 254,
    drivenKm: 254,
    startOdometerKm: null,
    endOdometerKm: null,
    stationCount: 3,
    trackCount: 0,
    tourCount: 1,
    countries: ["NO"],
    points: [],
    nights: 1,
    stayNights: 1,
    freeNights: 0,
    placesSlept: 1,
    nightsKnown: true,
    ...over,
  } as RoadtripSummary;
}

function renderRow(
  over: Partial<RoadtripSummary>,
  phase: RoadtripPhase = "past",
  onOpen = vi.fn()
): void {
  render(
    <Table columns={columns} label="Roadtrips">
      <RoadtripTableRow roadtrip={summary(over)} phase={phase} columns={columns} onOpen={onOpen} />
    </Table>
  );
}

describe("RoadtripTableRow", () => {
  it("shows the name, vehicle, country name, stations and driven distance", () => {
    renderRow({});
    expect(screen.getByText("QA Roadtrip")).toBeInTheDocument();
    expect(screen.getByText("Campervan")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Norwegen" })).toBeInTheDocument();
    expect(screen.getByText("254 km")).toBeInTheDocument();
  });

  it("marks a business roadtrip with the purpose chip and a private one with none", () => {
    renderRow({ purpose: "business" });
    expect(screen.getByTestId("purpose-chip")).toBeInTheDocument();
  });

  it("shows no purpose chip for a private or unknown roadtrip", () => {
    renderRow({ purpose: "private" });
    expect(screen.queryByTestId("purpose-chip")).toBeNull();
  });

  it("opens the roadtrip when the row is clicked", () => {
    const onOpen = vi.fn();
    renderRow({}, "past", onOpen);
    fireEvent.click(screen.getByText("QA Roadtrip"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("marks a planned roadtrip", () => {
    renderRow({}, "planned");
    expect(screen.getByText("Geplant")).toBeInTheDocument();
  });

  it("says why the distance is a dash instead of showing a zero (forgejo#249)", () => {
    renderRow({ stationCount: 1, drivenKm: 0 });
    expect(screen.getByTestId("roadtrip-row-reasons")).toHaveTextContent("Noch keine Etappe");
    expect(screen.queryByText("0 km")).not.toBeInTheDocument();
  });

  it("says nothing extra when the distance is known", () => {
    renderRow({ stationCount: 3 });
    expect(screen.queryByTestId("roadtrip-row-reasons")).not.toBeInTheDocument();
  });
});
