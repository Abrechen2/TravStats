import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { germanUseTranslation } from "../../../../__tests__/helpers/germanT";
import InboxWorkspace from "../InboxWorkspace";
import { dataQualityFlagsApi } from "../../../../lib/api/dataQualityFlags";
import { tripSuggestionsApi } from "../../../../lib/api/tripSuggestions";
import { pendingUpdatesApi } from "../../../../lib/api/pendingUpdates";
import { photoJourneysApi } from "../../../../lib/api/photoJourneys";
import { tripsApi } from "../../../../lib/api/trips";
import { flag, photo, suggestion, trip } from "./fixtures";
import { answerInBulk } from "../../../../lib/api/inboxBulk";

vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: {
    list: vi.fn(async () => []),
    listPage: vi.fn(async () => ({ rows: [], truncated: false })),
    choices: vi.fn(),
  },
}));
vi.mock("../../../../lib/api/inboxBulk", () => ({ answerInBulk: vi.fn() }));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => germanUseTranslation(),
}));
vi.mock("../../../../lib/api/dataQualityFlags", () => ({
  dataQualityFlagsApi: { getAll: vi.fn(), run: vi.fn(), dismiss: vi.fn(), resolve: vi.fn() },
}));
vi.mock("../../../../lib/api/tripSuggestions", () => ({
  tripSuggestionsApi: { list: vi.fn(), accept: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../../../lib/api/pendingUpdates", () => ({
  pendingUpdatesApi: { getAll: vi.fn(), apply: vi.fn(), update: vi.fn(), reject: vi.fn() },
}));
vi.mock("../../../../lib/api/photoJourneys", () => ({
  photoJourneysApi: { list: vi.fn(), accept: vi.fn(), dismiss: vi.fn(), review: vi.fn() },
  photoJourneyPreviewUrl: () => "",
}));
vi.mock("../../../GlobeLoader", () => ({ GlobeLoader: () => null }));
vi.mock("../../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn(), getById: vi.fn(), update: vi.fn(), create: vi.fn() },
}));

/**
 * Bulk answers in the inbox (owner 2026-11-26): grouped by trip, narrowed by a period, and
 * "Alle annehmen" that leaves what needs input and reports a partial failure item by item.
 */
function mount(url = "/pending-updates") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <InboxWorkspace photosVisible />
    </MemoryRouter>
  );
}
const flag2 = { ...flag, id: "flag2" };
const PROPOSAL = "Reise mit diesen Angaben anlegen";

describe("Inbox bulk answers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [flag, flag2], count: 2 });
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue({
      suggestions: [suggestion],
      total: 1,
      home: "history",
      truncated: false,
    });
    vi.mocked(pendingUpdatesApi.getAll).mockResolvedValue({ updates: [], count: 0 });
    vi.mocked(photoJourneysApi.list).mockResolvedValue([photo]);
    vi.mocked(tripsApi.getAll).mockResolvedValue([trip]);
  });

  it("groups by trip: a trip's group answers its own items in bulk", async () => {
    mount("/pending-updates?view=journey");
    const group = await screen.findByTestId("inbox-bulk-group-trip:trip1");
    expect(within(group).getByRole("button", { name: "Alle annehmen (2)" })).toBeInTheDocument();
    vi.mocked(answerInBulk).mockResolvedValue([
      { kind: "review", id: "flag1", outcome: "skipped", reason: "needsInput" },
      { kind: "review", id: "flag2", outcome: "skipped", reason: "needsInput" },
    ]);
    await userEvent.click(within(group).getByRole("button", { name: "Alle annehmen (2)" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("2 Vorschläge:");
    await userEvent.click(within(dialog).getByRole("button", { name: "Alle annehmen" }));
    await waitFor(() =>
      expect(answerInBulk).toHaveBeenCalledWith("accept", [
        { kind: "review", id: "flag1" },
        { kind: "review", id: "flag2" },
      ])
    );
  });

  it("the period filter keeps only the items whose travel day lies in it, in the URL", async () => {
    mount("/pending-updates?from=2026-09-01&to=2026-09-30");
    await screen.findAllByRole("button", { name: "Reisezeitraum speichern und prüfen" });
    expect(screen.queryByRole("button", { name: PROPOSAL })).toBeNull();
    expect(screen.getByLabelText("Von")).toHaveValue("2026-09-01");
  });

  it("'Alle annehmen' leaves what needs input and names a failed item", async () => {
    vi.mocked(answerInBulk).mockResolvedValue([
      { kind: "review", id: "flag1", outcome: "skipped", reason: "needsInput" },
      { kind: "review", id: "flag2", outcome: "skipped", reason: "needsInput" },
      { kind: "trips", id: "suggestion1", outcome: "skipped", reason: "needsInput" },
      { kind: "photos", id: "photo1", outcome: "failed", reason: "SUGGESTION_NOT_FOUND" },
    ]);
    mount();
    const bar = await screen.findByTestId("inbox-bulk-all");
    await waitFor(() =>
      expect(within(bar).getByRole("button", { name: "Alle annehmen (4)" })).toBeInTheDocument()
    );
    await userEvent.click(within(bar).getByRole("button", { name: "Alle annehmen (4)" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Angenommen wird nur, was ohne Eingabe geht.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Alle annehmen" }));
    const alert = await within(bar).findByRole("alert");
    expect(alert).toHaveTextContent("0 erledigt · 3 braucht Eingabe · 1 fehlgeschlagen");
    expect(alert).toHaveTextContent("nicht mehr vorhanden");
    // Only inbox kinds go out: a plugin archive proposal is never part of a bulk answer.
    const sent = vi.mocked(answerInBulk).mock.calls[0][1].map((i) => i.kind);
    expect(sent.every((k) => k !== ("plugin" as string))).toBe(true);
  });

  it("says so when the bulk request fails as a whole", async () => {
    vi.mocked(answerInBulk).mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mount();
    const bar = await screen.findByTestId("inbox-bulk-all");
    await waitFor(() => within(bar).getByRole("button", { name: "Alle verwerfen (4)" }));
    await userEvent.click(within(bar).getByRole("button", { name: "Alle verwerfen (4)" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Alle verwerfen" })
    );
    expect(await within(bar).findByRole("alert")).toHaveTextContent(
      "Die Sammelantwort hat nicht geklappt."
    );
  });
});
