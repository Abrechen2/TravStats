import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import InboxWorkspace from "../InboxWorkspace";
import { dataQualityFlagsApi } from "../../../../lib/api/dataQualityFlags";
import { tripSuggestionsApi } from "../../../../lib/api/tripSuggestions";
import { pendingUpdatesApi } from "../../../../lib/api/pendingUpdates";
import { tripsApi } from "../../../../lib/api/trips";
import type { TripSuggestion, TripSuggestionList } from "../../../../types/tripSuggestion";

/**
 * The trip engine's proposals in the one inbox. What the card must never do is
 * the class-3 failure: report success it has not seen. Every failure path is
 * driven and what the user sees is asserted — the card stays, the card names
 * the cause, and a failed load is a failure, not an empty inbox.
 *
 * The global test setup makes `t` return its key.
 */

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
  photoJourneysApi: { list: vi.fn() },
  photoJourneyPreviewUrl: () => "",
}));
vi.mock("../../../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn() } }));
vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { list: vi.fn(async () => []), choices: vi.fn() },
}));
vi.mock("../../../GlobeLoader", () => ({ GlobeLoader: () => null }));

const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const NS = "dataQuality:inbox.tripSuggestions";
const W = "dataQuality:inbox.workspace";

const italy: TripSuggestion = {
  id: "new_trip:-:abc",
  kind: "new_trip",
  startDay: "2025-05-03",
  endDay: "2025-05-09",
  nights: 6,
  planned: false,
  destination: "Rom",
  signals: [],
  zoneUnknown: 0,
  members: [
    {
      key: "lodging:a",
      domain: "lodging",
      id: "a",
      label: "Hotel Florenz",
      startDay: "2025-05-03",
      endDay: "2025-05-06",
      planned: false,
    },
    {
      key: "rail:b",
      domain: "rail",
      id: "b",
      label: "FR 9519 Roma → München",
      startDay: "2025-05-09",
      endDay: "2025-05-09",
      planned: false,
    },
  ],
};

const listOf = (
  suggestions: TripSuggestion[],
  over: Partial<TripSuggestionList> = {}
): TripSuggestionList => ({
  suggestions,
  total: suggestions.length,
  home: "history",
  truncated: false,
  ...over,
});

/** An axios-shaped refusal with the server's code. */
const refused = (status: number, code: string) =>
  Object.assign(new Error("refused"), {
    isAxiosError: true,
    response: { status, data: { error: "x", code } },
  });

async function mount(url = "/pending-updates?tab=trips") {
  render(
    <MemoryRouter initialEntries={[url]}>
      <InboxWorkspace photosVisible={false} />
    </MemoryRouter>
  );
  await screen.findByText(`${W}.shown`);
}
const submit = () => screen.getByRole("button", { name: `${W}.acceptProposal.new_trip` });

describe("trip proposals in the inbox", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [], count: 0 });
    vi.mocked(pendingUpdatesApi.getAll).mockResolvedValue({ updates: [], count: 0 });
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue(listOf([italy]));
  });

  it("lists a proposal with its members, and says only trip-less tours move", async () => {
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue(
      listOf([
        {
          ...italy,
          members: [
            ...italy.members,
            {
              key: "tour:c",
              domain: "tour",
              id: "c",
              label: "Fiesole",
              startDay: "2025-05-04",
              endDay: "2025-05-04",
              planned: false,
            },
          ],
        },
      ])
    );
    await mount();
    expect(screen.getAllByText("Hotel Florenz").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fiesole").length).toBeGreaterThan(0);
    expect(screen.getByText(`${NS}.tourNote`)).toBeInTheDocument();
  });

  it("says nothing about tours when no tour is a member", async () => {
    await mount();
    expect(screen.queryByText(`${NS}.tourNote`)).not.toBeInTheDocument();
  });

  it("quick-accepts with the localized name once the editor is closed, confirms, and reloads", async () => {
    vi.mocked(tripSuggestionsApi.accept).mockResolvedValue({
      tripId: "t1",
      placeVisitId: null,
      linked: 2,
    });
    await mount();
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.cancel" }));
    await userEvent.click(submit());

    await waitFor(() =>
      expect(tripSuggestionsApi.accept).toHaveBeenCalledWith(italy.id, {
        name: expect.stringContaining("Rom · "),
      })
    );
    expect(addToast).toHaveBeenCalledWith("success", `${NS}.messages.accepted.new_trip`);
    await waitFor(() => expect(tripSuggestionsApi.list).toHaveBeenCalledTimes(2));
  });

  it("sends the edited name, dates and only the kept members", async () => {
    vi.mocked(tripSuggestionsApi.accept).mockResolvedValue({
      tripId: "t1",
      placeVisitId: null,
      linked: 1,
    });
    await mount();
    const name = screen.getByLabelText(`${NS}.edit.name`);
    await userEvent.clear(name);
    await userEvent.type(name, "Toskana");
    await userEvent.click(screen.getByRole("checkbox", { name: "FR 9519 Roma → München" }));
    await userEvent.click(submit());

    await waitFor(() =>
      expect(tripSuggestionsApi.accept).toHaveBeenCalledWith(italy.id, {
        name: "Toskana",
        startDay: "2025-05-03",
        endDay: "2025-05-09",
        memberKeys: ["lodging:a"],
      })
    );
  });

  it("will not send an edit without a member", async () => {
    await mount();
    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);
    expect(screen.getByRole("alert")).toHaveTextContent(`${NS}.errors.noMembers`);
    expect(submit()).toBeDisabled();
  });

  it("says why an accept failed, keeps the card, and reloads a changed proposal", async () => {
    vi.mocked(tripSuggestionsApi.accept).mockRejectedValue(refused(409, "TRIP_SUGGESTION_STALE"));
    await mount();
    await userEvent.click(submit());

    expect(await screen.findByText(`${NS}.errors.stale`)).toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalledWith("success", expect.anything());
    await waitFor(() => expect(tripSuggestionsApi.list).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("Hotel Florenz").length).toBeGreaterThan(0);
  });

  it("names a network failure as one, and does not reload as if it had saved", async () => {
    vi.mocked(tripSuggestionsApi.accept).mockRejectedValue(
      Object.assign(new Error("Network Error"), { isAxiosError: true })
    );
    await mount();
    await userEvent.click(submit());

    expect(await screen.findByText("common:saveErrors.network")).toBeInTheDocument();
    expect(tripSuggestionsApi.list).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(submit()).toBeEnabled());
  });

  it("dismisses with a confirmation, and says a failed dismissal failed", async () => {
    vi.mocked(tripSuggestionsApi.dismiss).mockRejectedValueOnce(refused(500, "INTERNAL"));
    await mount();
    await userEvent.click(screen.getByRole("button", { name: `${W}.dismissProposal.new_trip` }));
    expect(await screen.findByText(`${W}.saveFailed`)).toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalledWith("success", expect.anything());

    vi.mocked(tripSuggestionsApi.dismiss).mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByRole("button", { name: `${W}.dismissProposal.new_trip` }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("success", `${NS}.messages.dismissed`)
    );
  });

  it("shows a failed load as a failure with a retry, never as an empty inbox", async () => {
    vi.mocked(tripSuggestionsApi.list).mockRejectedValueOnce(new Error("boom"));
    await mount();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(`${W}.sources.trips`);
    expect(screen.queryByText(`${NS}.empty.title`)).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: `${W}.retry` }));
    expect((await screen.findAllByText("Hotel Florenz")).length).toBeGreaterThan(0);
  });

  it("tells a user without a home why so little is proposed, and says the kind is empty", async () => {
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue(listOf([], { home: "missing" }));
    await mount();
    expect(screen.getByText(`${NS}.home.missing`)).toBeInTheDocument();
    expect(screen.getByText(`${NS}.empty.title`)).toBeInTheDocument();
  });

  it("says when the home was only estimated", async () => {
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue(listOf([italy], { home: "estimated" }));
    await mount();
    expect(screen.getByText(`${NS}.home.estimated`)).toBeInTheDocument();
  });
});
