import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number; minutes?: number }) =>
      opts?.count !== undefined
        ? `${k}/${opts.count}`
        : opts?.minutes !== undefined
          ? `${k}/${opts.minutes}`
          : k,
    i18n: { language: "de" },
    ready: true,
  }),
}));
const addToast = vi.fn();
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }),
}));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/table/LogbookTabs", () => ({ default: () => null }));
vi.mock("../../components/rail/RailFormModal", () => ({
  RailFormModal: ({ journey }: { journey: { id: string } | null }) => (
    <div data-testid="rail-form">{journey ? journey.id : "new"}</div>
  ),
}));
vi.mock("../../components/Training/ConfirmModal", () => ({
  default: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? (
      <button type="button" onClick={onConfirm}>
        confirm-delete
      </button>
    ) : null,
}));

const list = vi.fn();
const remove = vi.fn();
vi.mock("../../lib/api/rail", () => ({
  railApi: {
    list: (...a: unknown[]) => list(...a),
    remove: (...a: unknown[]) => remove(...a),
  },
}));

import RailPage from "../RailPage";
import type { RailJourney } from "../../types/rail";

function journey(over: Partial<RailJourney> = {}): RailJourney {
  return {
    id: "j1",
    userId: "u1",
    operator: "DB Fernverkehr",
    trainCategory: "ICE",
    trainNumber: "9557",
    depStationName: "Frankfurt (Main) Hbf",
    depStationCode: null,
    depLat: 50.1,
    depLon: 8.66,
    depCountry: "DE",
    depTimezone: "Europe/Berlin",
    arrStationName: "Paris Est",
    arrStationCode: null,
    arrLat: 48.88,
    arrLon: 2.36,
    arrCountry: "FR",
    arrTimezone: "Europe/Paris",
    departureTime: "2026-07-01T06:15:00.000Z",
    arrivalTime: "2026-07-01T10:09:00.000Z",
    distanceKm: 478.2,
    distanceSource: "great_circle",
    geometry: null,
    geometrySource: "straight",
    actualDepartureTime: null,
    actualArrivalTime: null,
    lookupProvider: null,
    lookupRef: null,
    travelClass: null,
    coach: null,
    seat: null,
    bookingReference: null,
    price: null,
    currency: "EUR",
    status: "completed",
    delayMinutes: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

describe("RailPage", () => {
  beforeEach(() => {
    list.mockReset();
    remove.mockReset();
    addToast.mockReset();
  });

  it("lists journeys with times on each station's own clock", async () => {
    list.mockResolvedValue({ journeys: [journey()], total: 1 });
    render(<RailPage />);
    const row = await screen.findByTestId("rail-row-j1");
    expect(row.textContent).toContain("Frankfurt (Main) Hbf → Paris Est");
    // 06:15 UTC read in Frankfurt, 10:09 UTC read in Paris — never the viewer's zone.
    expect(row.textContent).toContain("08:15");
    expect(row.textContent).toContain("12:09");
    expect(row.textContent).toContain("ICE 9557 · DB Fernverkehr");
    expect(row.textContent).toContain("rail:straightLine");
    expect(screen.getByText("rail:count/1")).toBeInTheDocument();
  });

  it("asks the server for one page, not the whole logbook", async () => {
    list.mockResolvedValue({ journeys: [], total: 0 });
    render(<RailPage />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(list.mock.calls[0][0]).toMatchObject({ limit: 50, offset: 0 });
  });

  it("says a failed load instead of drawing an empty logbook", async () => {
    list.mockRejectedValue(new Error("down"));
    render(<RailPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("rail:loadError");
    expect(screen.queryByText("rail:empty")).toBeNull();
  });

  it("shows the empty state only for a logbook that loaded and is empty", async () => {
    list.mockResolvedValue({ journeys: [], total: 0 });
    render(<RailPage />);
    expect(await screen.findByText("rail:empty")).toBeInTheDocument();
  });

  it("keeps a recorded on-time arrival apart from an unrecorded delay", async () => {
    list.mockResolvedValue({
      journeys: [journey({ id: "a", delayMinutes: 0 }), journey({ id: "b", delayMinutes: 12 })],
      total: 2,
    });
    render(<RailPage />);
    expect((await screen.findByTestId("rail-row-a")).textContent).toContain("rail:onTime");
    expect(screen.getByTestId("rail-row-b").textContent).toContain("rail:delay/12");
  });

  it("opens the form for a new and for an existing journey", async () => {
    list.mockResolvedValue({ journeys: [journey()], total: 1 });
    render(<RailPage />);
    await screen.findByTestId("rail-row-j1");
    fireEvent.click(screen.getByText("rail:add"));
    expect(screen.getByTestId("rail-form")).toHaveTextContent("new");
  });

  it("deletes after confirmation and reloads the list", async () => {
    list.mockResolvedValueOnce({ journeys: [journey()], total: 1 });
    list.mockResolvedValueOnce({ journeys: [], total: 0 });
    remove.mockResolvedValue(undefined);
    render(<RailPage />);
    await screen.findByTestId("rail-row-j1");
    fireEvent.click(screen.getByText("rail:delete"));
    fireEvent.click(screen.getByText("confirm-delete"));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("j1"));
    expect(await screen.findByText("rail:empty")).toBeInTheDocument();
    expect(addToast).toHaveBeenCalledWith("success", "rail:deleted");
  });
});
