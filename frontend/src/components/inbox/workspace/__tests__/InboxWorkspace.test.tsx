import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { germanUseTranslation } from "../../../../__tests__/helpers/germanT";
import InboxWorkspace from "../InboxWorkspace";
import { dataQualityFlagsApi } from "../../../../lib/api/dataQualityFlags";
import { tripSuggestionsApi } from "../../../../lib/api/tripSuggestions";
import { pendingUpdatesApi } from "../../../../lib/api/pendingUpdates";
import { photoJourneysApi } from "../../../../lib/api/photoJourneys";
import { tripsApi } from "../../../../lib/api/trips";
import { flag, photo, suggestion, trip, update } from "./fixtures";

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
async function ready() {
  await screen.findByRole("button", { name: "Reisezeitraum speichern und prüfen" });
}

describe("Inbox workspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [flag], count: 1 });
    vi.mocked(dataQualityFlagsApi.run).mockResolvedValue({
      opened: 0,
      reopened: 0,
      updated: 0,
      autoResolved: 1,
      open: 0,
    });
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue({
      suggestions: [suggestion],
      total: 1,
      home: "history",
      truncated: false,
    });
    vi.mocked(pendingUpdatesApi.getAll).mockResolvedValue({ updates: [], count: 0 });
    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockResolvedValue([trip]);
    vi.mocked(tripsApi.update).mockResolvedValue(trip);
    vi.mocked(tripsApi.create).mockResolvedValue({ ...trip, id: "created-trip" });
  });

  it("keeps draft values across cards, list, journey and search without writing", async () => {
    mount();
    await ready();
    const end = screen.getAllByLabelText("Ende")[0];
    fireEvent.change(end, { target: { value: "2026-09-17" } });
    await userEvent.click(screen.getByRole("radio", { name: "Liste" }));
    expect(screen.getAllByLabelText("Ende")[0]).toHaveValue("2026-09-17");
    await userEvent.click(screen.getByRole("radio", { name: "Nach Reise" }));
    expect(screen.getAllByLabelText("Ende")[0]).toHaveValue("2026-09-17");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Wien" } });
    expect(
      screen.getByRole("button", { name: "Reisezeitraum speichern und prüfen", hidden: true })
    ).not.toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.getAllByLabelText("Ende")[0]).toHaveValue("2026-09-17");
    expect(tripsApi.update).not.toHaveBeenCalled();
    expect(tripSuggestionsApi.accept).not.toHaveBeenCalled();
  });

  it("saves the exact trip dates, rechecks and never dismisses the question", async () => {
    mount();
    await ready();
    fireEvent.change(screen.getAllByLabelText("Ende")[0], { target: { value: "2026-09-17" } });
    vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [], count: 0 });
    await userEvent.click(
      screen.getByRole("button", { name: "Reisezeitraum speichern und prüfen" })
    );
    await waitFor(() =>
      expect(tripsApi.update).toHaveBeenCalledWith("trip1", {
        startDate: "2026-09-12",
        endDate: "2026-09-17",
      })
    );
    expect(dataQualityFlagsApi.run).toHaveBeenCalledOnce();
    expect(dataQualityFlagsApi.dismiss).not.toHaveBeenCalled();
    expect(dataQualityFlagsApi.resolve).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Reisezeitraum speichern und prüfen" })
      ).not.toBeInTheDocument()
    );
  });

  it("distinguishes a successful save from a failed subsequent check", async () => {
    vi.mocked(dataQualityFlagsApi.run).mockRejectedValue(new Error("offline"));
    mount();
    await ready();
    await userEvent.click(
      screen.getByRole("button", { name: "Reisezeitraum speichern und prüfen" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Gespeichert. Die anschließende Prüfung ist fehlgeschlagen"
    );
    expect(tripsApi.update).toHaveBeenCalledOnce();
  });

  it("keeps a failed save editable and prevents duplicate submissions", async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(tripsApi.update).mockImplementation(
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        })
    );
    mount();
    await ready();
    const button = screen.getByRole("button", { name: "Reisezeitraum speichern und prüfen" });
    await userEvent.dblClick(button);
    expect(tripsApi.update).toHaveBeenCalledOnce();
    reject(new Error("offline"));
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(dataQualityFlagsApi.run).not.toHaveBeenCalled();
  });

  it("labels partial source failure, retains other sections and allows retry", async () => {
    vi.mocked(tripSuggestionsApi.list).mockRejectedValue(new Error("offline"));
    mount();
    await ready();
    expect(screen.getByRole("alert")).toHaveTextContent("Reisevorschläge");
    expect(
      screen.queryByText("Alle geladenen Fragen und Vorschläge sind erledigt.")
    ).not.toBeInTheDocument();
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue({
      suggestions: [suggestion],
      total: 1,
      home: "history",
      truncated: false,
    });
    await userEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(
      await screen.findByRole("button", { name: "Reise mit ausgewählten Einträgen anlegen" })
    ).toBeInTheDocument();
  });

  it("defers and restores an item without dismissing or saving it", async () => {
    mount();
    await ready();
    await userEvent.click(screen.getAllByRole("button", { name: "Später in diesem Besuch" })[0]);
    expect(
      screen.queryByRole("button", { name: "Reisezeitraum speichern und prüfen" })
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zurückgestellt (1)" }));
    expect(
      screen.getByRole("button", { name: "Reisezeitraum speichern und prüfen" })
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zurück in die offenen Einträge" }));
    expect(dataQualityFlagsApi.dismiss).not.toHaveBeenCalled();
    expect(tripsApi.update).not.toHaveBeenCalled();
  });

  it("shows every flight change and applies corrected values in order", async () => {
    vi.mocked(pendingUpdatesApi.getAll).mockImplementation(async (filter) => ({
      updates: filter?.status === "pending" ? [update] : [],
      count: 1,
    }));
    mount();
    await ready();
    expect(screen.getByLabelText("Airline")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Gate"), { target: { value: "C9" } });
    await userEvent.click(screen.getByRole("button", { name: "Änderungen in Flug übernehmen" }));
    await waitFor(() => expect(pendingUpdatesApi.apply).toHaveBeenCalledWith("update1"));
    expect(pendingUpdatesApi.update).toHaveBeenCalledWith("update1", {
      ...update.proposedData,
      gate: "C9",
    });
    expect(vi.mocked(pendingUpdatesApi.update).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(pendingUpdatesApi.apply).mock.invocationCallOrder[0]
    );
  });

  it("retains a created photo trip on link failure across all three views", async () => {
    vi.mocked(photoJourneysApi.list).mockResolvedValue([photo]);
    vi.mocked(photoJourneysApi.accept)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(null);
    mount("/pending-updates", true);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Reise mit diesen Angaben anlegen" }));
    await screen.findByRole("alert");
    expect(tripsApi.create).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("radio", { name: "Liste" }));
    await userEvent.click(screen.getByRole("radio", { name: "Nach Reise" }));
    await userEvent.click(screen.getByRole("button", { name: "Reise mit diesen Angaben anlegen" }));
    await waitFor(() => expect(photoJourneysApi.accept).toHaveBeenCalledTimes(2));
    expect(tripsApi.create).toHaveBeenCalledOnce();
    expect(photoJourneysApi.accept).toHaveBeenLastCalledWith("photo1", {
      createdTripId: "created-trip",
    });
  });

  it("does not load hidden photo features and offers all view controls by keyboard", async () => {
    mount();
    await ready();
    expect(photoJourneysApi.list).not.toHaveBeenCalled();
    // A radio group: arrow keys move the choice, the chosen pill is the tab stop.
    const views = screen.getByRole("radiogroup", { name: "Ansicht wählen" });
    within(views).getByRole("radio", { name: "Karten" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(within(views).getByRole("radio", { name: "Liste" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });
});
