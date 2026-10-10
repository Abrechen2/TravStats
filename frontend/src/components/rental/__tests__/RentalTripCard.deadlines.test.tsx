import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RentalTripCard } from "../RentalTripCard";
import type { TripRental } from "../../../types/rental";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${Object.values(o).join("|")}` : k),
    i18n: { language: "de" },
  }),
}));

const when = {
  utc: "2027-05-02T07:00:00.000Z",
  zone: "Europe/Lisbon",
  offset: "+01:00",
  local: "2027-05-02T08:00:00",
  precision: "minute" as const,
  zoneSource: "stored" as const,
};

const rental = (times?: TripRental["times"]): TripRental => ({
  id: "r1",
  provider: "Beispiel Autos",
  pickupStationName: "Lisboa",
  returnStationName: "Lisboa",
  pickupTime: when.utc,
  returnTime: "2027-05-06T07:00:00.000Z",
  pickupTimezone: "Europe/Lisbon",
  returnTimezone: "Europe/Lisbon",
  pickupPrecision: "minute",
  returnPrecision: "minute",
  status: "scheduled",
  times,
});

describe("RentalTripCard — deadlines (forgejo#285)", () => {
  it("lists the rental's deadlines on the pickup card", () => {
    render(
      <MemoryRouter>
        <RentalTripCard
          rental={rental({
            freeCancellationOn: { date: "2027-04-30", zone: "Europe/Lisbon", precision: "day" },
          })}
          end="pickup"
          when={when}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("rental-trip-card-deadline")).toHaveTextContent(
      /common:deadlines.freeCancellation: common:deadlines.untilEndOfDay/
    );
  });

  it("shows nothing for a rental without deadlines, or an older server's", () => {
    render(
      <MemoryRouter>
        <RentalTripCard rental={rental()} end="pickup" when={when} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("rental-trip-card-deadline")).toBeNull();
  });
});
