import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const get = vi.fn();
const put = vi.fn();
vi.mock("../../../lib/api/companionData", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/companionData")>(
    "../../../lib/api/companionData"
  );
  return {
    ...actual,
    packingApi: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) },
  };
});

import TripPackingCard from "../TripPackingCard";

const list = (rev: number, labels: Array<[string, boolean]>) => ({
  rev,
  updatedAt: "2026-10-30T10:00:00.000Z",
  items: labels.map(([label, done], i) => ({ id: `i${i}`, label, done })),
});
const stale = () =>
  Object.assign(new Error("409"), {
    isAxiosError: true,
    response: { status: 409, data: { code: "PACKING_LIST_STALE", rev: 5 } },
  });

describe("TripPackingCard (TripPackingList on the trip page)", () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue(list(3, [["Passport", false]]));
    put.mockReset();
  });

  it("writes a ticked item with the rev it read and shows what the server answered", async () => {
    put.mockResolvedValue(list(4, [["Passport", true]]));
    render(<TripPackingCard tripId="t1" />);
    await userEvent.click(await screen.findByRole("checkbox"));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [tripId, items, baseRev, mutationId] = put.mock.calls[0];
    expect(tripId).toBe("t1");
    expect(items).toEqual([{ id: "i0", label: "Passport", done: true }]);
    expect(baseRev).toBe(3);
    expect(typeof mutationId).toBe("string");
    await waitFor(() =>
      expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true)
    );
  });

  it("reloads and says so when the app changed the list first, instead of overwriting it", async () => {
    put.mockRejectedValue(stale());
    get.mockResolvedValueOnce(list(3, [["Passport", false]]));
    get.mockResolvedValueOnce(
      list(5, [
        ["Passport", false],
        ["Charger", false],
      ])
    );
    render(<TripPackingCard tripId="t1" />);
    await userEvent.click(await screen.findByRole("checkbox"));
    expect(await screen.findByText("trips:packing.notice.stale")).toBeTruthy();
    expect(screen.getByText("Charger")).toBeTruthy(); // the app's item is on screen
    expect(put).toHaveBeenCalledTimes(1); // no silent retry on top of the newer list
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(false);
  });

  it("says the change was not applied when the stale reload itself fails", async () => {
    put.mockRejectedValue(stale());
    get.mockResolvedValueOnce(list(3, [["Passport", false]]));
    get.mockRejectedValueOnce(new Error("offline"));
    render(<TripPackingCard tripId="t1" />);
    await userEvent.click(await screen.findByRole("checkbox"));
    expect(await screen.findByText("trips:packing.notice.staleReloadFailed")).toBeTruthy();
  });

  it("shows 'not saved' and keeps the stored list when a write fails", async () => {
    put.mockRejectedValue(new Error("500"));
    render(<TripPackingCard tripId="t1" />);
    await userEvent.click(await screen.findByRole("checkbox"));
    expect(await screen.findByText("trips:packing.notice.saveFailed")).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("offers a retry when the list cannot be loaded, instead of showing an empty list", async () => {
    get.mockRejectedValueOnce(new Error("offline"));
    render(<TripPackingCard tripId="t1" />);
    expect(await screen.findByText("trips:packing.loadFailed")).toBeTruthy();
    expect(screen.queryByText("trips:packing.empty")).toBeNull();
    await userEvent.click(screen.getByText("trips:packing.retry"));
    expect(await screen.findByText("Passport")).toBeTruthy();
  });

  it("adds an item as a new row after the existing ones, starting from rev 0 on a trip without a list", async () => {
    get.mockReset().mockResolvedValue({ items: [], rev: 0, updatedAt: null });
    put.mockResolvedValue(list(1, [["Sunscreen", false]]));
    render(<TripPackingCard tripId="t1" />);
    await userEvent.type(await screen.findByLabelText("trips:packing.addLabel"), "Sunscreen");
    await userEvent.click(screen.getByText("trips:packing.add"));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][1]).toMatchObject([{ label: "Sunscreen", done: false }]);
    expect(put.mock.calls[0][2]).toBe(0);
    expect(await screen.findByText("Sunscreen")).toBeTruthy();
  });

  it("resends a write whose answer was lost with the same mutation id", async () => {
    put.mockRejectedValueOnce(new Error("Network Error"));
    put.mockResolvedValueOnce(list(4, [["Passport", true]]));
    render(<TripPackingCard tripId="t1" />);
    await userEvent.click(await screen.findByRole("checkbox"));
    await userEvent.click(await screen.findByText("trips:packing.retry"));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[1][3]).toBe(put.mock.calls[0][3]);
    expect(put.mock.calls[1][2]).toBe(put.mock.calls[0][2]);
    expect(put.mock.calls[1][1]).toEqual(put.mock.calls[0][1]);
  });
});
