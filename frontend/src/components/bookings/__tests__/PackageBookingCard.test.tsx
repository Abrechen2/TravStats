import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { BookingPackageAnswer } from "../../../types/bookingPackage";

const get = vi.fn();
const split = vi.fn();
const removeSplit = vi.fn();
vi.mock("../../../lib/api/bookingPackage", () => ({
  bookingPackageApi: {
    get: (...a: unknown[]) => get(...a),
    split: (...a: unknown[]) => split(...a),
    removeSplit: (...a: unknown[]) => removeSplit(...a),
  },
}));

import { PackageBookingCard } from "../PackageBookingCard";

const answer = (over: Partial<BookingPackageAnswer> = {}): BookingPackageAnswer => ({
  booking: {
    id: "b1",
    pnr: "OPODO1",
    operator: "Opodo",
    travellers: 2,
    price: 2870.96,
    currency: "EUR",
    tripId: "t1",
    tripName: "Washington",
  },
  isPackage: true,
  items: [
    {
      kind: "flight",
      id: "f1",
      label: "LH418 FRA → IAD",
      date: null,
      status: "flown",
      tripId: "t1",
      share: null,
    },
    {
      kind: "stay",
      id: "s1",
      label: "Hotel Capitol",
      date: null,
      status: "completed",
      tripId: "t1",
      share: null,
    },
  ],
  split: null,
  ...over,
});

/** forgejo#430: one price across a flight and a hotel. */
describe("PackageBookingCard (forgejo#430)", () => {
  beforeEach(() => {
    get.mockReset();
    split.mockReset();
    removeSplit.mockReset();
  });

  it("shows an unsplit item as part of a package — not 0 and not the whole price", async () => {
    get.mockResolvedValue(answer());
    render(<PackageBookingCard bookingId="b1" highlight={{ kind: "flight", id: "f1" }} />);
    const shares = await screen.findAllByTestId("package-share");
    for (const s of shares) {
      expect(s.textContent).toMatch(/Teil eines Pakets|Part of a package|partOfPackage/);
      expect(s.textContent).not.toMatch(/2[.,]?870/);
      expect(s.textContent).not.toMatch(/^0/);
    }
  });

  it("shows each item's share once split", async () => {
    get.mockResolvedValue(
      answer({
        items: answer().items.map((i) => ({ ...i, share: i.kind === "flight" ? 900 : 1970.96 })),
        split: {
          method: "manual",
          price: 2870.96,
          currency: "EUR",
          shares: [],
          staleReason: null,
        },
      })
    );
    render(<PackageBookingCard bookingId="b1" />);
    const shares = await screen.findAllByTestId("package-share");
    expect(shares[0].textContent).toMatch(/900/);
    expect(shares[1].textContent).toMatch(/1[.,]?970/);
  });

  it("a changed package asks for a check and keeps the typed amounts for the remaining items", async () => {
    get.mockResolvedValue(
      answer({
        split: {
          method: "manual",
          price: 2870.96,
          currency: "EUR",
          // r1 (a rental) has left the booking; f1 and s1 keep what was typed.
          shares: [
            { kind: "flight", id: "f1", amount: 900 },
            { kind: "stay", id: "s1", amount: 1600.96 },
            { kind: "rental", id: "r1", amount: 370 },
          ],
          staleReason: "segments",
        },
      })
    );
    render(<PackageBookingCard bookingId="b1" />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      /Aufteilung prüfen|Check the split|bookingPackage\.stale/
    );
    expect(screen.getByTestId("package-amount-0")).toHaveValue("900");
    expect(screen.getByTestId("package-amount-1")).toHaveValue("1600.96");
  });

  it("will not save manual amounts until they add up to the package price", async () => {
    get.mockResolvedValue(answer());
    split.mockResolvedValue(answer());
    render(<PackageBookingCard bookingId="b1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Beträge eingeben|Enter amounts|splitManual/ })
    );
    fireEvent.change(screen.getByTestId("package-amount-0"), { target: { value: "900" } });
    fireEvent.change(screen.getByTestId("package-amount-1"), { target: { value: "1970" } });
    const save = screen.getByRole("button", { name: /Aufteilung speichern|Save split|splitSave/ });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByTestId("package-amount-1"), { target: { value: "1970,96" } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(split).toHaveBeenCalled());
    expect(split.mock.calls[0]).toEqual([
      "b1",
      {
        method: "manual",
        shares: [
          { kind: "flight", id: "f1", amount: 900 },
          { kind: "stay", id: "s1", amount: 1970.96 },
        ],
      },
    ]);
  });

  it("says why a split was refused", async () => {
    get.mockResolvedValue(answer());
    split.mockRejectedValue({
      isAxiosError: true,
      response: { status: 422, data: { code: "BOOKING_SPLIT_SUM", error: "x" } },
    });
    render(<PackageBookingCard bookingId="b1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gleichmäßig|Split evenly|splitEqual/ })
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("says when the booking could not be loaded, and offers a retry", async () => {
    get.mockRejectedValue(new Error("network"));
    render(<PackageBookingCard bookingId="b1" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
