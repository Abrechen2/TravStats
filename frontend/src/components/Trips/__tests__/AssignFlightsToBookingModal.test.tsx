import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const flightsApi = vi.hoisted(() => ({ getEvery: vi.fn() }));
const tripsApi = vi.hoisted(() => ({ fileFlightsOnBooking: vi.fn() }));
vi.mock("../../../lib/api/flights", () => ({ flightsApi }));
vi.mock("../../../lib/api/trips", () => ({ tripsApi }));

import AssignFlightsToBookingModal from "../AssignFlightsToBookingModal";

// The test i18n returns keys, so assertions name the key of the sentence.
const axiosError = (status?: number): Error =>
  Object.assign(new Error("request failed"), {
    isAxiosError: true,
    ...(status ? { response: { status } } : {}),
  });

const flight = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  flightNumber: `LH${id}`,
  depIata: "FRA",
  arrIata: "JFK",
  departureTime: "2024-05-01T10:00:00.000Z",
  bookingId: null,
  ...over,
});
const booking = { id: "b1", userId: "u1", tripId: "t1" };

beforeEach(() => {
  vi.clearAllMocks();
  flightsApi.getEvery.mockResolvedValue([
    flight("1"),
    flight("2", { bookingId: "b1" }),
    flight("3", { bookingId: "other" }),
  ]);
});
afterEach(() => cleanup());

describe("AssignFlightsToBookingModal (forgejo#407)", () => {
  it("offers the account's flights not yet on the booking and files the picked ones in one call", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AssignFlightsToBookingModal booking={booking as never} onClose={onClose} />);
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes).toHaveLength(2); // flight 2 is already on this booking
    expect(screen.getByText(/bookingAssign\.onOtherBooking/)).toBeInTheDocument();
    await user.click(boxes[0]);
    await user.click(screen.getByRole("button", { name: /bookingAssign\.file/ }));
    await waitFor(() => expect(tripsApi.fileFlightsOnBooking).toHaveBeenCalledWith("b1", ["1"]));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it.each([
    [404, /addExisting\.failure\.notFound/],
    [403, /addExisting\.failure\.readOnly/],
    [undefined, /addExisting\.failure\.network/],
  ])(
    "says its own reason when the call fails (HTTP %s) and files nothing",
    async (status, text) => {
      tripsApi.fileFlightsOnBooking.mockRejectedValue(axiosError(status));
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(<AssignFlightsToBookingModal booking={booking as never} onClose={onClose} />);
      await user.click((await screen.findAllByRole("checkbox"))[0]);
      await user.click(screen.getByRole("button", { name: /bookingAssign\.file/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(onClose).not.toHaveBeenCalled();
    }
  );

  it("says why the flights could not be listed, and offers a retry", async () => {
    flightsApi.getEvery.mockRejectedValueOnce(axiosError(429));
    render(<AssignFlightsToBookingModal booking={booking as never} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/failure\.rateLimited/);
    await userEvent.setup().click(screen.getByRole("button", { name: /retry/ }));
    expect(await screen.findAllByRole("checkbox")).toHaveLength(2);
  });
});
