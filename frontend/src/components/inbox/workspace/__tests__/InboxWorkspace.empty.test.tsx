import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { germanUseTranslation } from "../../../../__tests__/helpers/germanT";
import InboxWorkspace from "../InboxWorkspace";
import { dataQualityFlagsApi } from "../../../../lib/api/dataQualityFlags";
import { tripSuggestionsApi } from "../../../../lib/api/tripSuggestions";
import { pendingUpdatesApi } from "../../../../lib/api/pendingUpdates";
import { photoJourneysApi } from "../../../../lib/api/photoJourneys";
import { tripsApi } from "../../../../lib/api/trips";
import { flag, trip } from "./fixtures";

vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { list: vi.fn(async () => []), choices: vi.fn() },
}));
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

function mount(url = "/pending-updates", photosVisible = false) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <InboxWorkspace photosVisible={photosVisible} />
    </MemoryRouter>
  );
}
/**
 * Audit 2026-10-26 (U3): an inbox with nothing in it showed eight "(0)"
 * filters, three view modes, a search, "Aktualisieren" and "Erneut prüfen"
 * before saying it was empty. Empty, it is one message with one action that
 * says what the re-check does; with items, the toolbar is as it was.
 */
describe("Inbox workspace, empty", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [], count: 0 });
    vi.mocked(dataQualityFlagsApi.run).mockResolvedValue({
      opened: 0,
      reopened: 0,
      updated: 0,
      autoResolved: 0,
      open: 0,
    });
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue({
      suggestions: [],
      total: 0,
      home: "history",
      truncated: false,
    });
    vi.mocked(pendingUpdatesApi.getAll).mockResolvedValue({ updates: [], count: 0 });
    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockResolvedValue([trip]);
  });

  it("shows one message and one action instead of the toolbar", async () => {
    mount();
    const empty = await screen.findByTestId("inbox-empty");
    expect(empty).toHaveTextContent("Alle geladenen Fragen und Vorschläge sind erledigt.");
    // What the action does, in words: it looks through the existing data again.
    expect(empty).toHaveTextContent("vorhandenen Daten");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Karten" })).toBeNull();
    expect(screen.queryByRole("button", { name: /\(0\)/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aktualisieren" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Erneut prüfen" }));
    await waitFor(() => expect(dataQualityFlagsApi.run).toHaveBeenCalledOnce());
    // The check reloads the inbox and hands the button back.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Erneut prüfen" })).toBeEnabled()
    );
  });

  it("keeps search, views and filters once there is something to do", async () => {
    vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [flag], count: 1 });
    mount();
    expect(await screen.findByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Karten" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aktualisieren" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erneut prüfen" })).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-empty")).toBeNull();
  });
});
