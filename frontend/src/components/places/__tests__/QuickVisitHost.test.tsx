/**
 * "Besuch erfassen" from a place pin's card on the map (forgejo#231). The card
 * sits deep inside both maps; the page that can reload them hosts the dialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlaceVisit } from "../../../types/place";
import { useQuickVisitStore } from "../../../store/quickVisitStore";

const createVisit = vi.fn();
const addToast = vi.fn();
vi.mock("../../../lib/api/places", () => ({
  createVisit: (...a: unknown[]) => createVisit(...a),
  updateVisit: vi.fn(),
  uploadVisitPhotos: vi.fn(),
  getVisitDateSuggestions: vi.fn(async () => []),
}));
vi.mock("../../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn(async () => []) } }));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...a: unknown[]) => void }) => unknown) =>
    selector({ addToast }),
}));

import { QuickVisitHost } from "../QuickVisitHost";
import { PlaceBody } from "../../map/cards/cardBodies";

const t = ((key: string) => key) as unknown as Parameters<typeof PlaceBody>[0]["t"];
const card = <PlaceBody data={{ id: "p1", name: "Wartburg", visited: false }} locale="de" t={t} />;

describe("QuickVisitHost + the place card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createVisit.mockResolvedValue({ id: "v1" } as unknown as PlaceVisit);
  });
  afterEach(() => {
    cleanup(); // unmount first, so resetting the store re-renders nothing
    useQuickVisitStore.setState({ target: null, hosts: 0 });
  });

  it("offers nothing on a map whose page hosts no dialog", () => {
    render(card);
    expect(screen.queryByRole("button", { name: "places:visit.action" })).not.toBeInTheDocument();
  });

  it("opens the dialog for that place, records the visit, reloads the map and closes", async () => {
    const onSaved = vi.fn();
    render(
      <>
        {card}
        <QuickVisitHost onSaved={onSaved} />
      </>
    );
    await userEvent.click(screen.getByRole("button", { name: "places:visit.action" }));
    await act(async () => {}); // the dialog's trip list settles
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(createVisit).toHaveBeenCalledWith("p1", expect.objectContaining({ notes: null }));
    expect(addToast).toHaveBeenCalledWith("success", "places:visit.recorded");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("stops offering the action when the host goes away", () => {
    const { rerender } = render(
      <>
        {card}
        <QuickVisitHost />
      </>
    );
    expect(screen.getByRole("button", { name: "places:visit.action" })).toBeInTheDocument();
    rerender(card);
    expect(screen.queryByRole("button", { name: "places:visit.action" })).not.toBeInTheDocument();
  });
});
