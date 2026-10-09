import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import RoadtripDetailPage from "../RoadtripDetailPage";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { stationDraftKey } from "../../lib/roadtrip/stationDraftStore";
import { useAuthStore } from "../../store/authStore";
import type { RoadtripDetail, RoadtripStation, StationInput } from "../../types/roadtrip";

/**
 * forgejo#244 end to end, with the real editor and its autosave: a save that
 * cannot reach the server leaves a LOCAL draft; the next visit offers it back;
 * a server that moved on meanwhile asks per field; discarding clears it.
 */
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/Trips/TripMap", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("../../components/location/LocationInput", () => ({ LocationInput: () => <div /> }));
vi.mock("../../lib/api/lodging", () => ({
  listLodgings: vi.fn(async () => []),
  createLodging: vi.fn(),
  createStay: vi.fn(),
  deleteLodging: vi.fn(),
}));
vi.mock("../../lib/api/roadtrips", () => ({
  roadtripsApi: { get: vi.fn(), replaceStations: vi.fn() },
}));
vi.mock("../../lib/api/tours", () => ({
  toursApi: { geometry: vi.fn(async () => null), removeStandalone: vi.fn() },
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "value" in o
        ? `${k}=${String(o.value)}`
        : o && "name" in o && "field" in o
          ? `${k}:${String(o.name)}/${String(o.field)}`
          : k,
    i18n: { language: "de" },
  }),
}));

const ID = "11111111-1111-4111-8111-111111111111";
const at = (d: string): string => `${d}T00:00:00.000Z`;
const station = (title: string): RoadtripStation => ({
  id: ID,
  title,
  lat: 60.39,
  lon: 5.32,
  startDate: at("2026-07-12"),
  endDate: at("2026-07-13"),
  notes: null,
  order: 0,
  state: "free",
  lodgingStayId: null,
  stay: null,
});
const detail = (title: string): RoadtripDetail => ({
  roadtrip: { id: "rt", name: "Fjorde", vehicle: null, vehicleName: null } as never,
  countries: [],
  trip: null,
  startDate: at("2026-07-12"),
  endDate: at("2026-07-13"),
  nights: { stayNights: 0, freeNights: 1, nights: 1, nightsKnown: true, placesSlept: 1 },
  stations: [station(title)],
  legs: [],
  tours: [],
  routingAvailable: false,
  expenses: [],
  costs: { total: {}, byStation: [], byLeg: [], unpinned: {} },
});

const networkError = (): Error =>
  Object.assign(new Error("Network Error"), { isAxiosError: true, response: undefined });

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/roadtrips/rt"]}>
      <Routes>
        <Route path="/roadtrips/:id" element={<RoadtripDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Opens the editor, renames the station, and lets the autosave pause pass. */
async function renameInEditor(name: string): Promise<void> {
  fireEvent.click(await screen.findByText("roadtrips:detail.edit"));
  await settle();
  fireEvent.click(screen.getByText("Bergen"));
  fireEvent.change(screen.getByLabelText("roadtrips:editor.name"), { target: { value: name } });
  await settle(800);
}

const stored = (): Record<string, unknown> | null => {
  const raw = window.localStorage.getItem(stationDraftKey("u1", "rt"));
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};

describe("RoadtripDetailPage — local station drafts (forgejo#244)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-12T12:00:00.000Z"));
    useAuthStore.setState({ user: { id: "u1", username: "anna", isAdmin: false } as never });
    vi.mocked(roadtripsApi.get).mockResolvedValue(detail("Bergen"));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    useAuthStore.setState({ user: null });
  });

  it("keeps an edit that could not be saved on this device, and says so apart from the server", async () => {
    vi.mocked(roadtripsApi.replaceStations).mockRejectedValue(networkError());
    renderPage();
    await renameInEditor("Bergen sentrum");

    const status = screen
      .getAllByRole("status")
      .find((el) => el.textContent?.includes("roadtrips:editor.status.error"));
    expect(status).toHaveTextContent("roadtrips:editor.local.kept");
    expect(stored()?.drafts).toEqual([expect.objectContaining({ title: "Bergen sentrum" })]);
    // "Fertig" does not close over edits the server does not have.
    fireEvent.click(screen.getByText("roadtrips:detail.done"));
    await settle(10);
    expect(screen.getByLabelText("roadtrips:editor.name")).toBeInTheDocument();
  });

  it("offers the kept draft on the next visit and sends it once restored", async () => {
    vi.mocked(roadtripsApi.replaceStations).mockRejectedValueOnce(networkError());
    renderPage();
    await renameInEditor("Bergen sentrum");
    cleanup();

    vi.mocked(roadtripsApi.replaceStations).mockImplementation(
      async (_id, list: StationInput[]) => ({
        roadtrip: {} as never,
        nights: {} as never,
        legs: [],
        stations: list.map((s) => ({ ...station(s.title), ...s, id: s.id ?? ID }) as never),
      })
    );
    renderPage();
    const banner = (await screen.findByText("roadtrips:draft.title")).parentElement as HTMLElement;
    fireEvent.click(within(banner).getByText("roadtrips:draft.restore"));
    await settle(800);

    const calls = vi.mocked(roadtripsApi.replaceStations).mock.calls;
    const last = calls[calls.length - 1];
    expect(last[1]).toEqual([expect.objectContaining({ id: ID, title: "Bergen sentrum" })]);
    expect(last[2]).toEqual([ID]);
    // On the server now: the local copy is gone.
    expect(stored()).toBeNull();
  });

  it("shows the conflict per field when the server changed the same station meanwhile", async () => {
    vi.mocked(roadtripsApi.replaceStations).mockRejectedValueOnce(networkError());
    renderPage();
    await renameInEditor("Bergen sentrum");
    cleanup();

    // Meanwhile, elsewhere: the server's name changed too.
    vi.mocked(roadtripsApi.get).mockResolvedValue(detail("Bergen Bryggen"));
    vi.mocked(roadtripsApi.replaceStations).mockImplementation(
      async (_id, list: StationInput[]) => ({
        roadtrip: {} as never,
        nights: {} as never,
        legs: [],
        stations: list.map((s) => ({ ...station(s.title), ...s, id: s.id ?? ID }) as never),
      })
    );
    renderPage();
    fireEvent.click(await screen.findByText("roadtrips:draft.restore"));
    await settle();

    const dialog = screen.getByRole("dialog", { name: "roadtrips:conflict.title" });
    expect(dialog).toHaveTextContent(
      "roadtrips:conflict.fieldLegend:Bergen Bryggen/roadtrips:conflict.field.title"
    );
    expect(within(dialog).getByLabelText("roadtrips:conflict.theirs=Bergen Bryggen")).toBeChecked();
    // Nothing goes to the server before the reader decides.
    expect(roadtripsApi.replaceStations).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByLabelText("roadtrips:conflict.mine=Bergen sentrum"));
    fireEvent.click(within(dialog).getByText("roadtrips:conflict.apply"));
    await settle(800);
    const calls = vi.mocked(roadtripsApi.replaceStations).mock.calls;
    expect(calls[calls.length - 1][1]).toEqual([
      expect.objectContaining({ id: ID, title: "Bergen sentrum" }),
    ]);
  });

  it("forgets the draft when the reader discards it on purpose", async () => {
    vi.mocked(roadtripsApi.replaceStations).mockRejectedValueOnce(networkError());
    renderPage();
    await renameInEditor("Bergen sentrum");
    cleanup();

    renderPage();
    fireEvent.click(await screen.findByText("roadtrips:draft.discard"));
    fireEvent.click(await screen.findByText("roadtrips:draft.discardConfirm"));
    await settle();
    expect(stored()).toBeNull();
    expect(screen.queryByText("roadtrips:draft.title")).not.toBeInTheDocument();
  });

  it("says nothing about a draft that the server holds after all", async () => {
    window.localStorage.setItem(
      stationDraftKey("u1", "rt"),
      JSON.stringify({
        version: 1,
        savedAt: "2026-07-12T10:00:00.000Z",
        base: [],
        drafts: [{ ...station("Bergen"), key: ID, night: { kind: "free" } }],
      })
    );
    renderPage();
    await screen.findByText("Fjorde");
    await settle();
    expect(screen.queryByText("roadtrips:draft.title")).not.toBeInTheDocument();
    expect(stored()).toBeNull();
  });

  it("merges when a save meets a list the phone changed, instead of deleting its station", async () => {
    vi.mocked(roadtripsApi.replaceStations).mockRejectedValueOnce(
      Object.assign(new Error("conflict"), {
        isAxiosError: true,
        response: { status: 409, data: { code: "ROADTRIP_STATIONS_CHANGED" } },
      })
    );
    renderPage();
    const phone = { ...station("Voss"), id: "22222222-2222-4222-8222-222222222222" };
    vi.mocked(roadtripsApi.get).mockResolvedValue({
      ...detail("Bergen"),
      stations: [station("Bergen"), phone],
    });
    await renameInEditor("Bergen sentrum");
    await settle();

    const dialog = screen.getByRole("dialog", { name: "roadtrips:conflict.title" });
    expect(within(dialog).getByTestId("conflict-added")).toHaveTextContent(
      "roadtrips:conflict.addedThere"
    );
    vi.mocked(roadtripsApi.replaceStations).mockImplementation(
      async (_id, list: StationInput[]) => ({
        roadtrip: {} as never,
        nights: {} as never,
        legs: [],
        stations: list.map((s) => ({ ...station(s.title), ...s, id: s.id ?? ID }) as never),
      })
    );
    fireEvent.click(within(dialog).getByText("roadtrips:conflict.apply"));
    await settle(800);
    const calls = vi.mocked(roadtripsApi.replaceStations).mock.calls;
    const last = calls[calls.length - 1];
    expect(last[1].map((s) => s.title)).toEqual(["Bergen sentrum", "Voss"]);
    expect(last[2]).toEqual([ID, phone.id]);
  });
});
