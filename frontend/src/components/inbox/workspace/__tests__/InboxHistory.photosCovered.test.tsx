import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PhotoJourney } from "../../../../types/photoJourney";

/**
 * forgejo#439: a photo suggestion the logbook already holds closes as
 * `covered`. The history names the entry that holds it and offers to take the
 * close back — it was the server's call, not the user's answer.
 */
const covered = {
  id: "j1",
  status: "covered",
  kind: "visit",
  label: "Stadtverwaltung Freiburg",
  startDate: "2026-11-11T12:10:00.000Z",
  resolvedAt: "2026-11-24T10:00:00.000Z",
  resolution: {
    resolution: "covered",
    coveredBy: { kind: "visit", id: "v1", name: "Rathaus Verw.geb., Freiburg", distanceM: 331 },
  },
} as unknown as PhotoJourney;

const list = vi.fn(async (status: string) => (status === "covered" ? [covered] : []));
const reopen = vi.fn(async (_id: string) => undefined);
vi.mock("../../../../lib/api/photoJourneys", () => ({
  photoJourneysApi: {
    list: (status: string) => list(status),
    reopen: (id: string) => reopen(id),
  },
}));

import InboxHistory from "../InboxHistory";

describe("InboxHistory — photo suggestions already recorded (forgejo#439)", () => {
  it("names the covering entry and takes the close back on undo", async () => {
    render(<InboxHistory source="photos" />);
    expect(await screen.findByText("Stadtverwaltung Freiburg")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith("covered");
    expect(screen.getByText(/trips:dawarichStays.coveredBy.visit/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /history.undoCovered/ }));
    expect(reopen).toHaveBeenCalledWith("j1");
  });

  it("says so when the undo fails", async () => {
    reopen.mockRejectedValueOnce(new Error("offline"));
    render(<InboxHistory source="photos" />);
    await userEvent.click(await screen.findByRole("button", { name: /history.undoCovered/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/history.undoFailed/);
  });
});
