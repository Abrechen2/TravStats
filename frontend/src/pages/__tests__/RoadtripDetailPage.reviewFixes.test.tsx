import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import RoadtripDetailPage from "../RoadtripDetailPage";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { stationDraftKey } from "../../lib/roadtrip/stationDraftStore";
import { useAuthStore } from "../../store/authStore";
import type { RoadtripDetail, RoadtripStation, StationInput } from "../../types/roadtrip";

/**
 * Review fix round 1 (forgejo#244, #242), with a SIGNED-IN user and the real
 * editor — the earlier tests ran without one, so nothing was ever written to
 * localStorage and the placeholder-overwrites-draft defect could not show.
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

function renderPage(url = "/roadtrips/rt"): void {
  render(
    <MemoryRouter initialEntries={[url]}>
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
  fireEvent.change(screen.getByLabelText(/roadtrips:editor.name/), { target: { value: name } });
  await settle(800);
}

const stored = (): Record<string, unknown> | null => {
  const raw = window.localStorage.getItem(stationDraftKey("u1", "rt"));
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};

const ID2 = "22222222-2222-4222-8222-222222222222";
const two = (): RoadtripDetail => {
  const d = detail("Bergen");
  return {
    ...d,
    stations: [
      d.stations[0],
      {
        ...station("Flam"),
        id: ID2,
        order: 1,
        startDate: at("2026-07-13"),
        endDate: at("2026-07-14"),
      },
    ],
  };
};
const echo = async (_id: string, list: StationInput[]) => ({
  roadtrip: {} as never,
  nights: {} as never,
  legs: [],
  stations: list.map((s, i) => ({ ...station(s.title), ...s, id: s.id ?? `x${i}` }) as never),
});
const sentTitles = (): string[] =>
  vi.mocked(roadtripsApi.replaceStations).mock.calls.map((c) => c[1].map((s) => s.title).join("|"));

describe("RoadtripDetailPage — review fixes, signed in", () => {
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

  // C1: the placeholder station is not the reader's work.
  for (const q of ["heute", "neu"]) {
    it(`?station=${q} opens the editor, keeps it open, and keeps no placeholder as a draft`, async () => {
      renderPage(`/roadtrips/rt?station=${q}`);
      await settle(50);
      await settle(1000);
      expect(screen.getByText("roadtrips:detail.done")).toBeInTheDocument();
      expect(screen.queryByText("roadtrips:draft.title")).not.toBeInTheDocument();
      expect(stored()).toBeNull();
    });
  }

  it("?station=heute leaves an earlier offline draft as it was and asks about it first", async () => {
    vi.mocked(roadtripsApi.replaceStations).mockRejectedValue(networkError());
    renderPage();
    await renameInEditor("Bergen sentrum");
    cleanup();

    renderPage("/roadtrips/rt?station=heute");
    await settle(50);
    await settle(1000);
    expect(stored()?.drafts).toEqual([expect.objectContaining({ title: "Bergen sentrum" })]);
    expect(screen.getByText("roadtrips:draft.title")).toBeInTheDocument();
    expect(screen.queryByText("roadtrips:detail.done")).not.toBeInTheDocument();
  });

  it("a placeholder that is then filled in IS kept", async () => {
    vi.mocked(roadtripsApi.replaceStations).mockRejectedValue(networkError());
    renderPage("/roadtrips/rt?station=neu");
    await settle(50);
    fireEvent.change(screen.getByLabelText(/roadtrips:editor.name/), { target: { value: "Voss" } });
    await settle(800);
    expect(stored()?.drafts).toEqual([
      expect.objectContaining({ title: "Bergen" }),
      expect.objectContaining({ title: "Voss" }),
    ]);
  });

  // I1: the stored draft changes only on a deliberate restore or discard.
  it("asks before “Bearbeiten” while a draft waits, and leaves the draft untouched on cancel", async () => {
    vi.mocked(roadtripsApi.replaceStations).mockRejectedValue(networkError());
    renderPage();
    await renameInEditor("Bergen sentrum");
    cleanup();

    renderPage();
    await screen.findByText("roadtrips:draft.title");
    fireEvent.click(screen.getByText("roadtrips:detail.edit"));
    const dialog = screen.getByRole("dialog", { name: "roadtrips:draft.firstTitle" });
    expect(screen.queryByText("roadtrips:detail.done")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByText("common:buttons.cancel"));
    await settle(800);
    expect(stored()?.drafts).toEqual([expect.objectContaining({ title: "Bergen sentrum" })]);
    expect(screen.getByText("roadtrips:draft.title")).toBeInTheDocument();
  });

  it("“Verwerfen und bearbeiten” is the deliberate discard: the draft goes, the editor opens", async () => {
    vi.mocked(roadtripsApi.replaceStations).mockRejectedValueOnce(networkError());
    renderPage();
    await renameInEditor("Bergen sentrum");
    cleanup();

    renderPage();
    await screen.findByText("roadtrips:draft.title");
    fireEvent.click(screen.getByText("roadtrips:detail.edit"));
    fireEvent.click(screen.getByText("roadtrips:draft.discardAndEdit"));
    await settle();
    expect(stored()).toBeNull();
    expect(screen.getByText("roadtrips:detail.done")).toBeInTheDocument();
  });

  it("cancelling the restore's merge keeps the draft and brings the banner back", async () => {
    vi.mocked(roadtripsApi.replaceStations).mockRejectedValue(networkError());
    renderPage();
    await renameInEditor("Bergen sentrum");
    cleanup();

    vi.mocked(roadtripsApi.get).mockResolvedValue(detail("Bergen Bryggen"));
    renderPage();
    fireEvent.click(await screen.findByText("roadtrips:draft.restore"));
    await settle();
    const dialog = screen.getByRole("dialog", { name: "roadtrips:conflict.title" });
    fireEvent.click(within(dialog).getByText("common:buttons.cancel"));
    await settle(800);
    expect(stored()?.drafts).toEqual([expect.objectContaining({ title: "Bergen sentrum" })]);
    expect(screen.getByText("roadtrips:draft.title")).toBeInTheDocument();
    expect(screen.queryByText("roadtrips:detail.done")).not.toBeInTheDocument();
  });

  // C2: a held change never leaves inside its undo window.
  it("does not send a held removal while a slow save is in flight and a second edit waits", async () => {
    vi.mocked(roadtripsApi.get).mockResolvedValue(two());
    vi.mocked(roadtripsApi.replaceStations).mockImplementation(
      (routeId, list: StationInput[]) =>
        new Promise((resolve) => setTimeout(() => resolve(echo(routeId, list)), 2000))
    );
    renderPage();
    fireEvent.click(await screen.findByText("roadtrips:detail.edit"));
    await settle();
    fireEvent.click(screen.getByText("Bergen"));
    fireEvent.change(screen.getByLabelText(/roadtrips:editor.name/), {
      target: { value: "Bergen A" },
    });
    await settle(800); // first save in flight for 2 s
    fireEvent.change(screen.getByLabelText(/roadtrips:editor.name/), {
      target: { value: "Bergen B" },
    });
    await settle(800); // its pause finds the save in flight and asks to send again
    const removes = screen.getAllByLabelText("roadtrips:stations.remove");
    fireEvent.click(removes[removes.length - 1]); // Flam, held for 8 s
    await settle(1500); // the first save lands inside the window
    await settle(4000);
    expect(sentTitles()).toEqual(["Bergen A|Flam"]);
    expect(screen.getByText("roadtrips:editor.removed")).toBeInTheDocument();

    await settle(5000); // the window closes: the held change goes out once
    await settle(2500);
    expect(sentTitles()).toEqual(["Bergen A|Flam", "Bergen B"]);
  });

  it("an undo inside the window restores locally, without a request", async () => {
    vi.mocked(roadtripsApi.get).mockResolvedValue(two());
    vi.mocked(roadtripsApi.replaceStations).mockImplementation(echo);
    renderPage();
    fireEvent.click(await screen.findByText("roadtrips:detail.edit"));
    await settle();
    const removes = screen.getAllByLabelText("roadtrips:stations.remove");
    fireEvent.click(removes[removes.length - 1]);
    await settle(2000);
    fireEvent.click(screen.getByText("roadtrips:editor.undo"));
    await settle(9000);
    expect(roadtripsApi.replaceStations).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
    expect(
      screen
        .getAllByRole("status")
        .some((el) => el.textContent?.includes("roadtrips:editor.status.saved"))
    ).toBe(true);
  });

  // Review M2: a legacy station without a coordinate is in no editor's list;
  // merging it in after a 409 held every later save on "Ort fehlt".
  it("leaves a station without a coordinate out of a live merge, so the merged list saves", async () => {
    vi.mocked(roadtripsApi.replaceStations)
      .mockRejectedValueOnce(
        Object.assign(new Error("conflict"), {
          isAxiosError: true,
          response: { status: 409, data: { code: "ROADTRIP_STATIONS_CHANGED" } },
        })
      )
      .mockImplementation(echo);
    renderPage();
    const legacy = { ...station("Altlast"), id: ID2, lat: null, lon: null };
    vi.mocked(roadtripsApi.get).mockResolvedValue({
      ...detail("Bergen"),
      stations: [station("Bergen"), legacy],
    });
    await renameInEditor("Bergen sentrum");
    await settle();
    const dialog = screen.getByRole("dialog", { name: "roadtrips:conflict.title" });
    expect(within(dialog).queryByTestId("conflict-added")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByText("roadtrips:conflict.apply"));
    await settle(800);
    const titles = sentTitles();
    expect(titles[titles.length - 1]).toBe("Bergen sentrum");
  });
});
