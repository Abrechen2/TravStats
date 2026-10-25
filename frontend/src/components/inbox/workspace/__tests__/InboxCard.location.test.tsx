import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { germanUseTranslation } from "../../../../__tests__/helpers/germanT";
import InboxCard from "../InboxCard";
import { buildInboxItems, type InboxItem } from "../model";
import {
  locationSuggestionsApi,
  type LocationSuggestion,
} from "../../../../lib/api/locationSuggestions";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => germanUseTranslation(),
}));
vi.mock("../../../../lib/api/locationSuggestions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api/locationSuggestions")>();
  return { ...actual, locationSuggestionsApi: { list: vi.fn(), accept: vi.fn(), reject: vi.fn() } };
});

/**
 * A TravTrack country question in the inbox (TravTrack plan E6): what
 * TravTrack saw — country, ground days, first and last day, points — and the
 * three answers. Each server refusal reaches the reader as itself: evidence
 * gone removes the card, an accept in progress is retried quietly, TravTrack
 * switched off keeps the question.
 */

const question: LocationSuggestion = {
  id: "q1",
  kind: "country",
  provider: { kind: "travtrack", rev: 1 },
  window: {
    fromMs: Date.parse("2026-10-12T00:00:00Z"),
    untilMs: Date.parse("2026-10-14T00:00:00Z"),
  },
  algorithm: { name: "country", version: 1 },
  explanation: { code: "country.groundDays", params: { country: "PT", days: 2, points: 140 } },
  status: "pending",
  coverage: "complete",
};

const refusal = (code: string, status = 409) =>
  Object.assign(new Error(code), { isAxiosError: true, response: { status, data: { code } } });

const t = germanUseTranslation().t as (key: string, o?: Record<string, unknown>) => string;

function mount(reload = vi.fn(async () => {})) {
  const [item] = buildInboxItems([{ source: "location", data: question }], [], t, "de");
  render(
    <MemoryRouter>
      <InboxCard
        item={item as InboxItem}
        disabled={false}
        reload={reload}
        stayChoices={{ places: [], trips: [] }}
        visitReview={
          {
            selected: new Set(),
            busy: new Set(),
            corrections: {},
            failures: [],
            toggle: vi.fn(),
            correct: vi.fn(),
            answer: vi.fn(),
          } as never
        }
      />
    </MemoryRouter>
  );
  return { item, reload };
}

describe("country question card", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is listed as a location question about the country", () => {
    const { item } = mount();
    expect(item.source).toBe("location");
    expect(item.subject).toBe("Portugal");
    expect(item.day).toBe("2026-10-12");
  });

  it("shows the country, the ground days, the first and last day and the points", () => {
    mount();
    expect(screen.getByText(/Warst du in Portugal\?/)).toBeInTheDocument();
    const evidence = screen.getByText(/an 2 Tagen am Boden/);
    expect(evidence).toHaveTextContent("140 Positionen");
    expect(evidence).toHaveTextContent(/12\.10\.2026.*13\.10\.2026/);
    expect(screen.getByText(/aus TravTrack/)).toBeInTheDocument();
  });

  it.each([
    ["Besucht", "visited"],
    ["Nur am Boden durchgereist", "ground"],
  ] as const)("„%s“ answers %s and reloads", async (label, verdict) => {
    vi.mocked(locationSuggestionsApi.accept).mockResolvedValue({ ...question, status: "accepted" });
    const { reload } = mount();

    fireEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(() => expect(locationSuggestionsApi.accept).toHaveBeenCalledWith("q1", verdict));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("„Nicht dort gewesen“ rejects and reloads", async () => {
    vi.mocked(locationSuggestionsApi.reject).mockResolvedValue({ ...question, status: "rejected" });
    const { reload } = mount();

    fireEvent.click(screen.getByRole("button", { name: "Nicht dort gewesen" }));

    await waitFor(() => expect(locationSuggestionsApi.reject).toHaveBeenCalledWith("q1"));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(locationSuggestionsApi.accept).not.toHaveBeenCalled();
  });

  it("EVIDENCE_INVALIDATED says the history went and removes the card", async () => {
    vi.mocked(locationSuggestionsApi.accept).mockRejectedValue(refusal("EVIDENCE_INVALIDATED"));
    const { reload } = mount();

    fireEvent.click(screen.getByRole("button", { name: "Besucht" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/gelöscht oder geändert/);
    expect(reload).toHaveBeenCalled();
  });

  it("SUGGESTION_ACCEPT_IN_PROGRESS is retried quietly", async () => {
    vi.mocked(locationSuggestionsApi.accept)
      .mockRejectedValueOnce(refusal("SUGGESTION_ACCEPT_IN_PROGRESS"))
      .mockResolvedValueOnce({ ...question, status: "accepted" });
    const { reload } = mount();

    fireEvent.click(screen.getByRole("button", { name: "Besucht" }));

    await waitFor(() => expect(locationSuggestionsApi.accept).toHaveBeenCalledTimes(2), {
      timeout: 4000,
    });
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("TRAVTRACK_DISABLED says so and keeps the question", async () => {
    vi.mocked(locationSuggestionsApi.accept).mockRejectedValue(refusal("TRAVTRACK_DISABLED", 403));
    const { reload } = mount();

    fireEvent.click(screen.getByRole("button", { name: "Besucht" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /TravTrack ist auf diesem Server ausgeschaltet/
    );
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Nicht dort gewesen" })).toBeEnabled();
  });

  it("SUGGESTION_ALREADY_RESOLVED says so and reloads", async () => {
    vi.mocked(locationSuggestionsApi.accept).mockRejectedValue(
      refusal("SUGGESTION_ALREADY_RESOLVED")
    );
    const { reload } = mount();

    fireEvent.click(screen.getByRole("button", { name: "Besucht" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/bereits beantwortet/);
    expect(reload).toHaveBeenCalled();
  });
});
