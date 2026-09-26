import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import TripSuggestionsTab from "../TripSuggestionsTab";
import { suggestedTripName } from "../tripSuggestionCopy";
import { tripSuggestionsApi } from "../../../lib/api/tripSuggestions";
import type { TripSuggestion, TripSuggestionList } from "../../../types/tripSuggestion";

/**
 * The "Reise-Vorschläge" tab. What it must never do is the class-3 failure:
 * report success it has not seen. So every failure path is driven here and
 * what the user sees is asserted — the card stays, the toast names the cause,
 * and a failed load is a failure, not an empty inbox.
 */

vi.mock("../../../lib/api/tripSuggestions", () => ({
  tripSuggestionsApi: { list: vi.fn(), count: vi.fn(), accept: vi.fn(), dismiss: vi.fn() },
}));

const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const NS = "dataQuality:inbox.tripSuggestions";

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

const listOf = (suggestions: TripSuggestion[], over: Partial<TripSuggestionList> = {}) => ({
  suggestions,
  total: suggestions.length,
  home: "history" as const,
  truncated: false,
  ...over,
});

/** An axios-shaped refusal with the server's code. */
const refused = (status: number, code: string) =>
  Object.assign(new Error("refused"), {
    isAxiosError: true,
    response: { status, data: { error: "x", code } },
  });

function renderTab(onCount = vi.fn()) {
  render(
    <MemoryRouter>
      <TripSuggestionsTab onCount={onCount} />
    </MemoryRouter>
  );
  return onCount;
}

const acceptButton = () =>
  within(screen.getByTestId("trip-suggestion")).getByRole("button", {
    name: `${NS}.actions.accept`,
  });

describe("TripSuggestionsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue(listOf([italy]));
  });

  it("lists a proposal with its members and reports the count", async () => {
    const onCount = renderTab();
    expect(await screen.findByText("Hotel Florenz")).toBeInTheDocument();
    expect(screen.getByText("FR 9519 Roma → München")).toBeInTheDocument();
    expect(onCount).toHaveBeenCalledWith(1);
  });

  // Owner decision 2026-09-26: a day tour joins the trip it happened on, and
  // the card says which tours move — only those without a trip of their own.
  it("lists a day tour as a member and says only trip-less tours move", async () => {
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
    renderTab();
    expect(await screen.findByText("Fiesole")).toBeInTheDocument();
    expect(screen.getByText("common:domain.tour")).toBeInTheDocument();
    expect(screen.getByText(`${NS}.tourNote`)).toBeInTheDocument();
  });

  it("says nothing about tours when no tour is a member", async () => {
    renderTab();
    await screen.findByText("Hotel Florenz");
    expect(screen.queryByText(`${NS}.tourNote`)).not.toBeInTheDocument();
  });

  it("accepts with the localized name, confirms, and reloads", async () => {
    vi.mocked(tripSuggestionsApi.accept).mockResolvedValue({
      tripId: "t1",
      placeVisitId: null,
      linked: 2,
    });
    renderTab();
    await screen.findByText("Hotel Florenz");
    await userEvent.click(acceptButton());

    await waitFor(() =>
      expect(tripSuggestionsApi.accept).toHaveBeenCalledWith(italy.id, {
        name: expect.stringContaining("Rom · "),
      })
    );
    expect(addToast).toHaveBeenCalledWith("success", `${NS}.messages.accepted.new_trip`);
    expect(tripSuggestionsApi.list).toHaveBeenCalledTimes(2);
  });

  it("sends the edited name, dates and only the kept members", async () => {
    vi.mocked(tripSuggestionsApi.accept).mockResolvedValue({
      tripId: "t1",
      placeVisitId: null,
      linked: 1,
    });
    renderTab();
    await screen.findByText("Hotel Florenz");
    await userEvent.click(screen.getByRole("button", { name: `${NS}.actions.edit` }));

    const name = screen.getByLabelText(`${NS}.edit.name`);
    await userEvent.clear(name);
    await userEvent.type(name, "Toskana");
    await userEvent.click(screen.getByRole("checkbox", { name: "FR 9519 Roma → München" }));
    await userEvent.click(screen.getByRole("button", { name: `${NS}.actions.acceptEdited` }));

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
    renderTab();
    await screen.findByText("Hotel Florenz");
    await userEvent.click(screen.getByRole("button", { name: `${NS}.actions.edit` }));
    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);

    expect(screen.getByRole("alert")).toHaveTextContent(`${NS}.errors.noMembers`);
    expect(screen.getByRole("button", { name: `${NS}.actions.acceptEdited` })).toBeDisabled();
  });

  it("says why an accept failed, keeps the card, and reloads a changed proposal", async () => {
    vi.mocked(tripSuggestionsApi.accept).mockRejectedValue(refused(409, "TRIP_SUGGESTION_STALE"));
    renderTab();
    await screen.findByText("Hotel Florenz");
    await userEvent.click(acceptButton());

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("error", `${NS}.errors.stale`));
    expect(addToast).not.toHaveBeenCalledWith("success", expect.anything());
    expect(tripSuggestionsApi.list).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Hotel Florenz")).toBeInTheDocument();
  });

  it("names a network failure as one, and does not reload as if it had saved", async () => {
    vi.mocked(tripSuggestionsApi.accept).mockRejectedValue(
      Object.assign(new Error("Network Error"), { isAxiosError: true })
    );
    renderTab();
    await screen.findByText("Hotel Florenz");
    await userEvent.click(acceptButton());

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "common:saveErrors.network")
    );
    expect(tripSuggestionsApi.list).toHaveBeenCalledTimes(1);
    expect(acceptButton()).toBeEnabled();
  });

  it("dismisses, and says a failed dismissal failed", async () => {
    vi.mocked(tripSuggestionsApi.dismiss).mockResolvedValueOnce(undefined);
    renderTab();
    await screen.findByText("Hotel Florenz");
    await userEvent.click(screen.getByRole("button", { name: `${NS}.actions.dismiss` }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("success", `${NS}.messages.dismissed`)
    );

    vi.mocked(tripSuggestionsApi.dismiss).mockRejectedValueOnce(refused(500, "INTERNAL"));
    await userEvent.click(screen.getByRole("button", { name: `${NS}.actions.dismiss` }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", `${NS}.errors.dismissFailed`)
    );
  });

  it("shows a failed load as a failure with a retry, never as an empty inbox", async () => {
    vi.mocked(tripSuggestionsApi.list).mockRejectedValueOnce(new Error("boom"));
    const onCount = renderTab();

    expect(await screen.findByText(`${NS}.errors.loadFailed`)).toBeInTheDocument();
    expect(screen.queryByText(`${NS}.empty.title`)).not.toBeInTheDocument();
    expect(onCount).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: `${NS}.actions.retry` }));
    expect(await screen.findByText("Hotel Florenz")).toBeInTheDocument();
  });

  it("tells a user without a home why so little is proposed", async () => {
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue(listOf([], { home: "missing" }));
    renderTab();
    expect(await screen.findByRole("status")).toHaveTextContent(`${NS}.home.missing`);
  });
});

describe("suggestedTripName", () => {
  const t = (key: string) => key;

  it("names destination and month in the reader's language", () => {
    expect(suggestedTripName({ destination: "Rom", startDay: "2025-05-03" }, "de", t)).toBe(
      "Rom · Mai 2025"
    );
    expect(suggestedTripName({ destination: "Rome", startDay: "2025-05-03" }, "en", t)).toBe(
      "Rome · May 2025"
    );
  });

  it("invents no place when there is no destination", () => {
    expect(suggestedTripName({ destination: null, startDay: "2025-12-31" }, "de", t)).toBe(
      `${NS}.nameFallback · Dezember 2025`
    );
  });
});
