import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import ShareNoticeCard from "../ShareNoticeCard";
import type { ShareNotice } from "../../../types/sharing";

/**
 * A share notice is a change already applied (owner decision 3, kept), shown on
 * the pending-update card's anatomy (spec 2026-10-16, D12): a kind pill, the
 * entry, the first changes inline, the rest behind Details — and undo as the
 * primary action while it is still possible.
 */
const notice = (over: Partial<ShareNotice>): ShareNotice => ({
  id: "n1",
  kind: "updated",
  entityType: "flight",
  entityKey: null,
  after: { label: "TP571 FRA → LIS", tripId: "t1", entryId: "f1" },
  createdAt: "2026-10-16T08:00:00.000Z",
  readAt: null,
  undoneAt: null,
  actor: { id: "u-anna", username: "anna", displayName: "Anna" },
  changes: [
    { field: "gate", before: { kind: "text", value: "A1" }, after: { kind: "text", value: "B12" } },
    { field: "terminal", before: { kind: "empty" }, after: { kind: "text", value: "2" } },
    {
      field: "aircraft",
      before: { kind: "text", value: "A320" },
      after: { kind: "text", value: "A321" },
    },
    {
      field: "status",
      before: { kind: "text", value: "scheduled" },
      after: { kind: "text", value: "flown" },
    },
  ],
  ...over,
});
const renderCard = (
  n: ShareNotice,
  handlers = { onRead: vi.fn(), onUndo: vi.fn(), onDeleteCopy: vi.fn() }
) => {
  render(
    <MemoryRouter>
      <ShareNoticeCard notice={n} busy={false} error={null} {...handlers} />
    </MemoryRouter>
  );
  return handlers;
};

describe("ShareNoticeCard", () => {
  it("makes undo the primary action of an applied change", async () => {
    const h = renderCard(notice({}));
    expect(screen.getByText("sharing:inbox.notices.kinds.updated")).toBeTruthy();
    expect(screen.getByText("TP571 FRA → LIS")).toBeTruthy();
    const undo = screen.getByRole("button", { name: "sharing:inbox.notices.undo" });
    expect(undo.getAttribute("data-variant")).toBe("primary");
    await userEvent.click(undo);
    expect(h.onUndo).toHaveBeenCalled();
  });

  it("says an own entry was moved in from another trip, and offers to move it back", async () => {
    const h = renderCard(
      notice({
        kind: "created",
        changes: [],
        after: {
          label: "TP576 LIS → FRA",
          tripId: "t1",
          entryId: "f1",
          joined: true,
          movedFrom: { tripId: "t-old", tripName: "Lissabon allein" },
        },
      })
    );
    expect(screen.getByText("sharing:inbox.notices.joinedMoved")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "sharing:inbox.notices.undoMove" }));
    expect(h.onUndo).toHaveBeenCalled();
  });

  it("offers no undo for a plain join", () => {
    renderCard(
      notice({
        kind: "created",
        changes: [],
        after: { label: "TP576", tripId: "t1", joined: true },
      })
    );
    expect(screen.getByText("sharing:inbox.notices.joined")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /undo/ })).toBeNull();
  });

  it("shows three changes inline and the rest in the details", async () => {
    renderCard(notice({}));
    expect(screen.getByText("B12")).toBeTruthy();
    expect(screen.queryByText("flown")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "sharing:inbox.notices.details" }));
    await userEvent.click(screen.getByRole("button", { name: /sharing:fields.status/ }));
    expect(screen.getByText("flown")).toBeTruthy();
  });

  it("reports the Details toggle state with aria-expanded", async () => {
    renderCard(notice({}));
    const toggle = screen.getByRole("button", { name: "sharing:inbox.notices.details" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows all changes and no Details button when there are three or fewer", () => {
    renderCard(notice({ changes: notice({}).changes.slice(0, 3) }));
    expect(screen.getAllByTestId("share-change")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "sharing:inbox.notices.details" })).toBeNull();
  });

  it("offers deleting the own copy after a delete, and no undo there", () => {
    renderCard(notice({ kind: "deleted", changes: [] }));
    expect(screen.getByRole("button", { name: "sharing:inbox.notices.deleteCopy" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "sharing:inbox.notices.undo" })).toBeNull();
  });

  it("offers no undo once it is undone, and says so", () => {
    renderCard(notice({ undoneAt: "2026-10-16T09:00:00.000Z" }));
    expect(screen.queryByRole("button", { name: "sharing:inbox.notices.undo" })).toBeNull();
    expect(screen.getByText("sharing:inbox.notices.undone")).toBeTruthy();
  });

  it("shows a refused action on the card as an alert", () => {
    render(
      <MemoryRouter>
        <ShareNoticeCard
          notice={notice({})}
          busy={false}
          error="stale"
          onRead={vi.fn()}
          onUndo={vi.fn()}
          onDeleteCopy={vi.fn()}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole("alert").textContent).toBe("stale");
  });
});
