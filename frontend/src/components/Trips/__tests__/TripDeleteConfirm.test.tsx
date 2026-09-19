/**
 * Finding 3 of the write-path audit (2026-09-19). The trip's copy was extended
 * the same week to name the journal entries, the tours with their recorded
 * tracks and the documents filed with it — prose, for the things that have no
 * number worth printing. The COUNT was still missing, and a trip is the entry
 * most likely to carry several documents at once.
 *
 * `Document.tripId` carries `onDelete: Cascade`, measured against the live
 * database by `backend/src/__tests__/integrity/cascades.integrity.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listForEntryMock = vi.fn();

vi.mock("../../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...args: unknown[]) => listForEntryMock(...args) },
}));

import TripDeleteConfirm from "../TripDeleteConfirm";

function renderDialog(open: boolean, props: Partial<{ onConfirm: () => void }> = {}) {
  return render(
    <TripDeleteConfirm
      isOpen={open}
      tripId="t1"
      tripName="Thüringen 2026"
      onClose={vi.fn()}
      onConfirm={props.onConfirm ?? vi.fn()}
    />
  );
}

describe("TripDeleteConfirm", () => {
  beforeEach(() => {
    listForEntryMock.mockReset();
    listForEntryMock.mockResolvedValue([]);
  });

  it("names the documents that cascade with the trip", async () => {
    listForEntryMock.mockResolvedValue([{ id: "d1" }, { id: "d2" }, { id: "d3" }]);
    renderDialog(true);

    const dialog = await screen.findByTestId("confirm-modal");
    await waitFor(() => expect(dialog.textContent).toContain("documents:deleteCascadeNote"));
    expect(listForEntryMock).toHaveBeenCalledWith({ type: "trip", id: "t1" });
  });

  it("counts nothing while it is closed", () => {
    renderDialog(false);

    // The trip page mounts this once and keeps it mounted; asking on mount
    // would put a request on every trip anybody opens.
    expect(listForEntryMock).not.toHaveBeenCalled();
  });

  it("opens at once and adds the line when the count arrives", async () => {
    let settle: (rows: { id: string }[]) => void = () => {};
    listForEntryMock.mockReturnValue(
      new Promise<{ id: string }[]>((resolve) => {
        settle = resolve;
      })
    );
    renderDialog(true);

    const dialog = await screen.findByTestId("confirm-modal");
    expect(dialog.textContent).toContain("trips:deleteTripConfirm");
    expect(dialog.textContent).not.toContain("documents:deleteCascadeNote");

    settle([{ id: "d1" }]);
    await waitFor(() => expect(dialog.textContent).toContain("documents:deleteCascadeNote"));
  });

  it("keeps the base sentence when the count cannot be had", async () => {
    listForEntryMock.mockRejectedValue(new Error("Network Error"));
    renderDialog(true);

    const dialog = await screen.findByTestId("confirm-modal");
    await waitFor(() => expect(listForEntryMock).toHaveBeenCalled());
    expect(dialog.textContent).toContain("trips:deleteTripConfirm");
    expect(dialog.textContent).not.toContain("documents:deleteCascadeNote");
  });

  it("confirms through to the caller", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderDialog(true, { onConfirm });

    const dialog = await screen.findByTestId("confirm-modal");
    await user.click(
      Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.textContent === "trips:deleteTrip"
      ) as HTMLButtonElement
    );

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
