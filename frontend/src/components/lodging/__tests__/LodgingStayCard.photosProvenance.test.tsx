/**
 * Owner, 2026-11-22 (rc.43 report): a stay's photos and the origin of its dates belong to the
 * STAY — each card shows its own, inside the card, like its documents. They used to sit under the
 * card as page-level blocks, so with two stays the photos of the second looked like the first's.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { LodgingStay } from "../../../types/lodging";

vi.mock("../../common/EntryPhotos", () => ({
  default: ({ kind, entryId }: { kind: string; entryId: string }) => (
    <div data-testid={`photos-${kind}-${entryId}`} />
  ),
}));
vi.mock("../../documents/DocumentsSection", () => ({ default: () => null }));
const setProvenance = vi.fn();
vi.mock("../../../lib/api/provenance", () => ({
  provenanceApi: { set: (...a: unknown[]) => setProvenance(...a) },
}));

import { LodgingStayCard } from "../LodgingStayCard";

const stay = (id: string, over: Partial<LodgingStay> = {}): LodgingStay =>
  ({
    id,
    lodgingId: "l1",
    checkIn: "2024-06-01T00:00:00.000Z",
    checkOut: "2024-06-05T00:00:00.000Z",
    datePrecision: "DAY",
    checkInTime: null,
    checkOutTime: null,
    nights: null,
    status: "completed",
    board: "none",
    currency: "EUR",
    ...over,
  }) as unknown as LodgingStay;

describe("LodgingStayCard: photos and origin belong to the stay", () => {
  it("renders each stay's photo strip INSIDE its own card", () => {
    render(
      <>
        <LodgingStayCard stay={stay("s1")} />
        <LodgingStayCard stay={stay("s2")} />
      </>
    );
    expect(
      within(screen.getByTestId("stay-card-s1")).getByTestId("photos-stay-s1")
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("stay-card-s2")).getByTestId("photos-stay-s2")
    ).toBeInTheDocument();
    expect(within(screen.getByTestId("stay-card-s1")).queryByTestId("photos-stay-s2")).toBeNull();
  });

  it("shows the origin as a quiet line inside the card, and nothing for an unknown origin", () => {
    render(
      <>
        <LodgingStayCard
          stay={stay("s1", {
            provenance: "remembered",
            rememberedNote: "summer trip",
            rememberedOn: "2024-05-01T00:00:00.000Z",
          } as Partial<LodgingStay>)}
        />
        <LodgingStayCard stay={stay("s2")} />
      </>
    );
    const line = within(screen.getByTestId("stay-card-s1")).getByTestId("provenance-line");
    expect(line).toHaveTextContent("provenance:line.remembered");
    expect(line).toHaveTextContent("summer trip");
    expect(within(screen.getByTestId("stay-card-s2")).queryByTestId("provenance-line")).toBeNull();
  });

  it("edits the origin from the card's ⋯, saves it and asks the page to re-read the stay", async () => {
    setProvenance.mockResolvedValue({ provenance: "recorded" });
    const reread = vi.fn();
    render(<LodgingStayCard stay={stay("s1")} onProvenanceSaved={reread} />);
    await userEvent.click(screen.getByTestId("stay-menu-s1"));
    await userEvent.click(screen.getByTestId("stay-provenance-s1"));
    const dialog = await screen.findByTestId("provenance-dialog-s1");
    await userEvent.click(within(dialog).getByLabelText("provenance:editor.recorded"));
    await userEvent.click(within(dialog).getByRole("button", { name: "provenance:editor.save" }));
    expect(setProvenance).toHaveBeenCalledWith(
      "lodgingStay",
      "s1",
      expect.objectContaining({ provenance: "recorded" })
    );
    expect(reread).toHaveBeenCalled();
    expect(screen.queryByTestId("provenance-dialog-s1")).toBeNull();
  });
});
