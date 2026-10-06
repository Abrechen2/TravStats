import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o?.count !== undefined
        ? `${k}/${String(o.count)}`
        : o?.seat !== undefined
          ? `${k}:${String(o.coach)}/${String(o.seat)}`
          : k,
    i18n: { language: "de" },
    ready: true,
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const update = vi.fn();
const create = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: {
    update: (...a: unknown[]) => update(...a),
    create: (...a: unknown[]) => create(...a),
  },
}));

import { RailReservationReviewModal } from "../RailReservationReviewModal";
import { reservationBooking, reservationLeg, target } from "./railReservationFixture";

const applyButton = (): HTMLElement =>
  screen.getByRole("button", { name: /rail:import.reservation.apply/ });

describe("RailReservationReviewModal (forgejo#203)", () => {
  beforeEach(() => {
    update.mockReset();
    create.mockReset();
  });

  it("shows each row's target journey or the reason there is none", () => {
    render(
      <RailReservationReviewModal
        booking={reservationBooking([
          reservationLeg({ kind: "attach", target: target(), subSection: true }),
          reservationLeg({ kind: "none", reason: "noJourney" }, { trainNumber: "2217" }),
          reservationLeg({
            kind: "several",
            targets: [target(), target({ id: "journey-2", departureLocal: "2026-04-19T21:10" })],
          }),
        ])}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByTestId("rail-reservation-target-0")).toHaveTextContent(
      "rail:import.reservation.forJourney: ICE 615 Musterstadt Hbf → Beispielburg Hbf, 19.04.2026 19:55"
    );
    expect(screen.getByText("rail:import.reservation.subSection")).toBeInTheDocument();
    expect(screen.getByTestId("rail-reservation-status-1")).toHaveTextContent(
      "rail:import.reservation.status.none.noJourney"
    );
    expect(screen.getByTestId("rail-reservation-status-2")).toHaveTextContent(
      "rail:import.reservation.status.several/2"
    );
    expect(screen.getByText(/19\.04\.2026 21:10/)).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(
      boxes.map((b) => [(b as HTMLInputElement).checked, (b as HTMLInputElement).disabled])
    ).toEqual([
      [true, false],
      [false, true],
      [false, true],
    ]);
    expect(applyButton()).toHaveTextContent("rail:import.reservation.apply/1");
  });

  it("applies the ticked seat to the existing journey and creates no journey", async () => {
    update.mockResolvedValue({ journey: { id: "journey-1" }, geometry: null });
    const onSaved = vi.fn();
    render(
      <RailReservationReviewModal
        booking={reservationBooking([
          reservationLeg({ kind: "attach", target: target(), subSection: false }),
          reservationLeg({ kind: "none", reason: "noSeat" }, { coach: null, seat: null }),
        ])}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />
    );

    fireEvent.click(applyButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("journey-1", { coach: "12", seat: "133" });
    expect(create).not.toHaveBeenCalled();
  });

  it("shows a different stored seat as a change, written only once the user ticks it", async () => {
    update.mockResolvedValue({ journey: { id: "journey-1" }, geometry: null });
    const onSaved = vi.fn();
    render(
      <RailReservationReviewModal
        booking={reservationBooking([
          reservationLeg({
            kind: "change",
            target: target({ coach: "7", seat: "61" }),
            subSection: false,
          }),
        ])}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />
    );

    expect(screen.getByTestId("rail-reservation-status-0")).toHaveTextContent(
      "rail:import.reservation.status.change:7/61"
    );
    expect(applyButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(applyButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(update).toHaveBeenCalledWith("journey-1", { coach: "12", seat: "133" });
  });

  it("says why a refused seat was refused and stays open", async () => {
    update.mockRejectedValueOnce({ response: { status: 404, data: {} } });
    const onSaved = vi.fn();
    render(
      <RailReservationReviewModal
        booking={reservationBooking([
          reservationLeg({ kind: "attach", target: target(), subSection: false }),
        ])}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />
    );

    fireEvent.click(applyButton());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
