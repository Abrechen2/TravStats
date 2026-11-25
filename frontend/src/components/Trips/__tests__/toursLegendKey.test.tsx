import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import { toursLegendKey } from "../tripMapGroups";
import { TripMapLegend } from "../TripMapLegend";

describe("the trip map legend names the tours group after what it holds (rc46 UAT)", () => {
  it("a roadtrip alone reads 'Roadtrips', not 'Touren'", () => {
    expect(toursLegendKey([{ routeId: "r", isRoadtrip: true }])).toBe(
      "trips:detail.map.legend.group.roadtrips"
    );
    expect(toursLegendKey([{ routeId: "r" }])).toBe("trips:detail.map.legend.group.tours");
    expect(toursLegendKey([{ routeId: "r", isRoadtrip: true }, { routeId: "s" }])).toBe(
      "trips:detail.map.legend.group.toursAndRoadtrips"
    );
  });

  it("the legend renders the label key it is given for a group", () => {
    render(
      <TripMapLegend
        present={new Set(["tours"])}
        hidden={new Set()}
        onToggle={vi.fn()}
        colors={{}}
        labelKeys={{ tours: "trips:detail.map.legend.group.roadtrips" }}
      />
    );
    expect(screen.getByText("trips:detail.map.legend.group.roadtrips")).toBeTruthy();
    expect(screen.queryByText("trips:detail.map.legend.group.tours")).toBeNull();
  });
});
