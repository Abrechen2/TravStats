import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { germanUseTranslation } from "../../../../__tests__/helpers/germanT";
import InboxCard from "../InboxCard";
import { buildInboxItems, type InboxItem } from "../model";
import {
  collapseTripAggregate,
  locationSuggestionsApi,
  type LocationSuggestion,
} from "../../../../lib/api/locationSuggestions";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => germanUseTranslation(),
}));
vi.mock("../../../../lib/api/locationSuggestions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api/locationSuggestions")>();
  return {
    ...actual,
    locationSuggestionsApi: { list: vi.fn(), acceptTrip: vi.fn(), reject: vi.fn() },
  };
});

/**
 * A trip TravTrack saw, in the inbox (TravTrack plan L4): days, countries and
 * km — no map. A new period is created as a trip under a name the reader may
 * change, or answered "Keine Reise"; a period touching a trip widens it or is
 * left. Questions beyond the per-run cap stand in one expandable entry.
 */

const away = (id: string, fromDay: string, extra: Partial<LocationSuggestion> = {}) =>
  ({
    id,
    kind: "trip",
    provider: { kind: "travtrack", rev: 1 },
    window: {
      fromMs: Date.parse(`${fromDay}T00:00:00Z`) - 2 * 3_600_000,
      untilMs: Date.parse(`${fromDay}T00:00:00Z`) + 3 * 86_400_000,
    },
    algorithm: { name: "trip", version: 1 },
    explanation: { code: "trip.away", params: { days: 3, km: 412 } },
    status: "pending",
    coverage: "complete",
    trip: {
      fromDay,
      toDay: "2026-10-12",
      zone: "Europe/Berlin",
      days: 3,
      countries: ["AT", "DE"],
      km: 412,
      tripId: null,
      tripName: null,
      aggregated: false,
    },
    ...extra,
  }) as LocationSuggestion;

const extend = away("q2", "2026-10-10", {
  explanation: { code: "trip.extend", params: { days: 3, km: 412, tripId: "t1" } },
});
extend.trip = { ...extend.trip!, tripId: "t1", tripName: "Wien" };

const refusal = (code: string, status = 409) =>
  Object.assign(new Error(code), { isAxiosError: true, response: { status, data: { code } } });

const t = germanUseTranslation().t as (key: string, o?: Record<string, unknown>) => string;

function mount(question: LocationSuggestion, reload = vi.fn(async () => {})) {
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

describe("trip question card", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is listed as a trip question about its first day", () => {
    const { item } = mount(away("q1", "2026-10-10"));
    expect(item.title).toBe("Reise aus deinem Standortverlauf");
    expect(item.subject).toBe("3 Tage unterwegs");
    expect(item.day).toBe("2026-10-10");
    expect(item.groupKey).toBe("unassigned");
  });

  it("shows the days, the countries and the km — no map", () => {
    mount(away("q1", "2026-10-10"));
    expect(
      screen.getByText(/Du warst vom 10\.10\.2026 bis 12\.10\.2026 unterwegs/)
    ).toBeInTheDocument();
    expect(screen.getByText(/bis zu 412 km entfernt/)).toBeInTheDocument();
    expect(screen.getByText("Länder: Österreich, Deutschland")).toBeInTheDocument();
    expect(document.querySelector("canvas, .maplibregl-map")).toBeNull();
  });

  it("„Als Reise anlegen“ creates the trip under the name typed", async () => {
    vi.mocked(locationSuggestionsApi.acceptTrip).mockResolvedValue({
      ...away("q1", "2026-10-10"),
      status: "accepted",
    });
    const { reload } = mount(away("q1", "2026-10-10"));
    const name = screen.getByLabelText("Name der Reise");
    expect(name).toHaveValue("Österreich, Deutschland");
    fireEvent.change(name, { target: { value: "  Alpen  " } });
    fireEvent.click(screen.getByRole("button", { name: "Als Reise anlegen" }));
    await waitFor(() =>
      expect(locationSuggestionsApi.acceptTrip).toHaveBeenCalledWith("q1", {
        action: "create",
        name: "Alpen",
      })
    );
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("a trip cannot be created without a name", () => {
    mount(away("q1", "2026-10-10"));
    fireEvent.change(screen.getByLabelText("Name der Reise"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Als Reise anlegen" })).toBeDisabled();
  });

  it("„Keine Reise“ rejects and reloads", async () => {
    vi.mocked(locationSuggestionsApi.reject).mockResolvedValue(away("q1", "2026-10-10"));
    const { reload } = mount(away("q1", "2026-10-10"));
    fireEvent.click(screen.getByRole("button", { name: "Keine Reise" }));
    await waitFor(() => expect(locationSuggestionsApi.reject).toHaveBeenCalledWith("q1"));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(locationSuggestionsApi.acceptTrip).not.toHaveBeenCalled();
  });

  it("a period touching a trip asks to widen it, grouped under that trip", async () => {
    vi.mocked(locationSuggestionsApi.acceptTrip).mockResolvedValue(extend);
    const { item } = mount(extend);
    expect(item.tripId).toBe("t1");
    expect(item.groupName).toBe("Wien");
    expect(screen.getByText(/gehört das zu deiner Reise „Wien“\?/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Name der Reise")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reise „Wien“ erweitern" }));
    await waitFor(() =>
      expect(locationSuggestionsApi.acceptTrip).toHaveBeenCalledWith("q2", {
        action: "extend",
        tripId: "t1",
      })
    );
    expect(screen.getByRole("button", { name: "Nicht erweitern" })).toBeInTheDocument();
  });

  it("EVIDENCE_INVALIDATED says the history went and removes the card", async () => {
    vi.mocked(locationSuggestionsApi.acceptTrip).mockRejectedValue(refusal("EVIDENCE_INVALIDATED"));
    const { reload } = mount(away("q1", "2026-10-10"));
    fireEvent.click(screen.getByRole("button", { name: "Als Reise anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/gelöscht oder geändert/);
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("TRAVTRACK_DISABLED keeps the question and says „Keine Reise“ still works", async () => {
    vi.mocked(locationSuggestionsApi.acceptTrip).mockRejectedValue(
      refusal("TRAVTRACK_DISABLED", 403)
    );
    const { reload } = mount(away("q1", "2026-10-10"));
    fireEvent.click(screen.getByRole("button", { name: "Als Reise anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ausgeschaltet/);
    expect(reload).not.toHaveBeenCalled();
  });

  it("SUGGESTION_ACCEPT_IN_PROGRESS is retried quietly", async () => {
    vi.mocked(locationSuggestionsApi.acceptTrip)
      .mockRejectedValueOnce(refusal("SUGGESTION_ACCEPT_IN_PROGRESS"))
      .mockResolvedValue({ ...away("q1", "2026-10-10"), status: "accepted" });
    const { reload } = mount(away("q1", "2026-10-10"));
    fireEvent.click(screen.getByRole("button", { name: "Als Reise anlegen" }));
    await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 3000 });
    expect(locationSuggestionsApi.acceptTrip).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the aggregate entry", () => {
  const waiting = (id: string, fromDay: string) => {
    const s = away(id, fromDay);
    return { ...s, trip: { ...s.trip!, aggregated: true } };
  };

  it("collapses every aggregated question into one entry, the newest standing for them", () => {
    const rows = [
      away("card", "2026-10-20"),
      waiting("old", "2026-09-01"),
      waiting("newer", "2026-09-10"),
    ];
    const collapsed = collapseTripAggregate(rows);
    expect(collapsed.map((r) => r.id)).toEqual(["card", "newer"]);
    expect(collapsed[1].aggregate?.map((r) => r.id)).toEqual(["newer", "old"]);
    expect(collapseTripAggregate([away("card", "2026-10-20")])).toHaveLength(1);
  });

  it("„Weitere N Zeiträume unterwegs“ shows nothing until it is expanded", () => {
    const [entry] = collapseTripAggregate([waiting("a", "2026-09-01"), waiting("b", "2026-09-10")]);
    const { item } = mount(entry);
    expect(item.subject).toBe("Weitere 2 Zeiträume unterwegs");
    expect(screen.getByText("Weitere 2 Zeiträume unterwegs")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Als Reise anlegen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Anzeigen" }));
    expect(screen.getAllByRole("button", { name: "Als Reise anlegen" })).toHaveLength(2);
  });
});
