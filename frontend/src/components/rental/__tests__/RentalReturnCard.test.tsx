import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

import { RentalReturnCard } from "../RentalReturnCard";
import { makeRental } from "./rentalFixture";

// forgejo#240: the return at a glance, on the return station's clock.
describe("RentalReturnCard", () => {
  it("shows station, time on its clock, fuel rule and notes, and navigates to the return", () => {
    render(
      <RentalReturnCard
        rental={makeRental({
          status: "in_progress",
          oneWay: true,
          returnStationName: "München Flughafen",
          returnLat: 48.35,
          returnLon: 11.78,
          fuelPolicy: "full_to_full",
          notes: "Schlüssel in den Kasten",
        })}
        onRecordReturn={vi.fn()}
      />
    );
    expect(screen.getByTestId("rental-return-station").textContent).toContain("München Flughafen");
    expect(screen.getByTestId("rental-return-when").textContent).toContain(
      "rental:returnCard.localTime"
    );
    expect(screen.getByTestId("rental-return-fuel").textContent).toContain(
      "rental:fuel.full_to_full"
    );
    expect(screen.getByTestId("rental-return-notes").textContent).toContain(
      "Schlüssel in den Kasten"
    );
    expect(screen.getByTestId("rental-return-navigate").getAttribute("href")).toContain(
      "destination=48.35,11.78"
    );
    expect(screen.getByText("rental:returnCard.oneWay")).toBeTruthy();
  });

  it("says what is missing instead of borrowing the pickup station", () => {
    render(
      <RentalReturnCard
        rental={makeRental({ status: "in_progress", returnLat: 0, returnLon: 0 })}
        onRecordReturn={vi.fn()}
      />
    );
    expect(screen.queryByTestId("rental-return-navigate")).toBeNull();
    expect(screen.getByTestId("rental-return-no-position").textContent).toBe(
      "rental:returnCard.noPosition"
    );
    expect(screen.getByTestId("rental-return-fuel").textContent).toContain(
      "rental:returnCard.fuelMissing"
    );
    expect(screen.getByTestId("rental-return-notes").textContent).toContain(
      "rental:returnCard.notesMissing"
    );
  });

  it("opens the return step from the card", () => {
    const onRecordReturn = vi.fn();
    render(<RentalReturnCard rental={makeRental()} onRecordReturn={onRecordReturn} />);
    fireEvent.click(screen.getByRole("button", { name: "rental:returnCard.record" }));
    expect(onRecordReturn).toHaveBeenCalledTimes(1);
  });
});
