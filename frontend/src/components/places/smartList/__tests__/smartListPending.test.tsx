/**
 * Pending confirmations on a smart list (owner 2026-11-26): only this rule's suggestions, an
 * accepted one leaves the section, "Alle bestätigen" asks first, and a failure is named.
 * Plus "Automatisch eingetragen" on a place's visits with its bulk undo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { SmartSuggestion } from "../../../../lib/api/smartLists";
import type { PlaceVisit } from "../../../../types/place";

const accept = vi.fn();
vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { accept: (...a: unknown[]) => accept(...a), reject: vi.fn() },
}));
const getListRule = vi.fn();
const listPendingConfirmations = vi.fn();
const undoAutomaticVisits = vi.fn();
vi.mock("../../../../lib/api/smartLists", async (orig) => ({
  ...(await orig<typeof import("../../../../lib/api/smartLists")>()),
  getListRule: (...a: unknown[]) => getListRule(...a),
  listPendingConfirmations: (...a: unknown[]) => listPendingConfirmations(...a),
  listNewOutlets: async () => [],
  listAutoAccepted: async () => [],
  undoAutomaticVisits: (...a: unknown[]) => undoAutomaticVisits(...a),
}));
vi.mock("../../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

import SmartListPanel from "../SmartListPanel";
import { PlaceVisitList } from "../../PlaceVisitList";

const row = (id: string, name: string): SmartSuggestion => ({
  id,
  placeId: `place-${id}`,
  name,
  startAt: "2026-11-22T11:40:00.000Z",
  endAt: "2026-11-22T12:05:00.000Z",
  startLocal: "2026-11-22T12:40",
  endLocal: "2026-11-22T13:05",
  zone: "Europe/Berlin",
  durationMinutes: 25,
  distanceM: 14,
  source: "travtrack",
  strength: "id",
  lists: [{ listId: "l1", listName: "Maccis" }],
  lat: 47.8,
  lon: 11.9,
});
const RULE = {
  listId: "l1",
  brands: [{ brandWikidataId: "Q38076", brandName: "McDonald's" }],
  minDwellMinutes: 5,
  maxDwellMinutes: 60,
  maxDistanceM: 100,
  autoAcceptDistanceM: 60,
  autoAccept: false,
};

const panel = (onChanged = vi.fn()) =>
  render(
    <SmartListPanel listId="l1" ruleOpen={false} onRuleClose={vi.fn()} onChanged={onChanged} />
  );

describe("SmartListPanel: pending confirmations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getListRule.mockResolvedValue(RULE);
  });

  it("shows this list's pending suggestions with a count, read for this list only", async () => {
    listPendingConfirmations.mockResolvedValue([row("a", "McD Hbf"), row("b", "McD Ost")]);
    panel();
    const section = await screen.findByTestId("smart-list-pending");
    expect(within(section).getByText("Ausstehende Bestätigungen (2)")).toBeInTheDocument();
    expect(within(section).getByText("McD Hbf")).toBeInTheDocument();
    expect(listPendingConfirmations).toHaveBeenCalledWith("l1");
  });

  it("an accepted suggestion moves to the visits: the section re-reads and the list is told", async () => {
    listPendingConfirmations.mockResolvedValueOnce([row("a", "McD Hbf")]).mockResolvedValueOnce([]);
    accept.mockResolvedValue(undefined);
    const changed = vi.fn();
    panel(changed);
    await userEvent.click(await screen.findByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(accept).toHaveBeenCalledWith("a", expect.objectContaining({ placeId: "place-a" }));
    await waitFor(() => expect(screen.queryByTestId("smart-list-pending")).toBeNull());
  });

  it("'Alle bestätigen' asks first and names a refused one", async () => {
    listPendingConfirmations.mockResolvedValue([row("a", "McD Hbf"), row("b", "McD Ost")]);
    accept
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ response: { status: 409, data: { code: "TRAVTRACK_DISABLED" } } });
    panel();
    await userEvent.click(await screen.findByRole("button", { name: "Alle bestätigen" }));
    expect(accept).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Alle bestätigen" }));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "McD Ost: TravTrack ist auf dieser Instanz ausgeschaltet"
    );
  });
});

describe("PlaceVisitList: Automatisch eingetragen", () => {
  const visit = (id: string, createdBy: string | null): PlaceVisit => ({
    id,
    placeId: "p",
    tripId: null,
    visitedAt: "2025-05-01T10:00:00.000Z",
    orderIdx: 0,
    notes: null,
    rating: null,
    createdAt: "2025-05-01T10:00:00.000Z",
    updatedAt: "2025-05-01T10:00:00.000Z",
    createdBy,
  });
  const list = (onVisitChanged = vi.fn()) =>
    render(
      <MemoryRouter>
        <PlaceVisitList
          visits={[visit("v1", "import"), visit("v2", null), visit("v3", "brandRule")]}
          placeVisited
          tripNames={new Map()}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onVisitChanged={onVisitChanged}
        />
      </MemoryRouter>
    );

  beforeEach(() => vi.clearAllMocks());

  it("filters to automatic visits and undoes exactly those after a confirmation", async () => {
    undoAutomaticVisits.mockResolvedValue([
      { visitId: "v1", outcome: "removed" },
      { visitId: "v3", outcome: "kept", reason: "ownerAdded" },
    ]);
    const changed = vi.fn();
    list(changed);
    await userEvent.click(screen.getByRole("button", { name: "Automatisch eingetragen (2)" }));
    await userEvent.click(screen.getByRole("button", { name: "Alle zurücknehmen" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Alle zurücknehmen" }));
    await waitFor(() => expect(undoAutomaticVisits).toHaveBeenCalledWith(["v1", "v3"]));
    expect(await screen.findByRole("status")).toHaveTextContent("1 zurückgenommen, 1 behalten.");
    expect(changed).toHaveBeenCalled();
  });

  it("says so when the bulk undo failed", async () => {
    undoAutomaticVisits.mockRejectedValue(new Error("boom"));
    list();
    await userEvent.click(screen.getByRole("button", { name: "Automatisch eingetragen (2)" }));
    await userEvent.click(screen.getByRole("button", { name: "Alle zurücknehmen" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Alle zurücknehmen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Das Zurücknehmen hat nicht geklappt"
    );
  });
});
