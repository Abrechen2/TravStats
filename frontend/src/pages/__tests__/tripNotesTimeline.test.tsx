import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Trip } from "../../types";

// Standalone notes on the trip timeline (forgejo#146): the reader's own notes
// at their moment on their own clock, editable in place; another member's
// shareable note read-only with its author; a failed load said, not hidden.
// The page scaffolding is the rail suite's.

const getByIdMock = vi.fn();

// The page renders the summary card, which asks the instance whether it has a
// text model at all (`GET /parser-capabilities`). The network guard fails any
// test that lets that request out (forgejo#110).
// Shared trips (2026-10-09): the trip overview, the settings and the inbox
// read the sharing API on mount; answered empty so no request escapes.
vi.mock("@/lib/api/sharing", () => ({
  sharingApi: {
    tripSharing: vi
      .fn()
      .mockResolvedValue({ groupId: null, members: [], candidates: [], bookingTotals: [] }),
    listConsents: vi.fn().mockResolvedValue({ incoming: [], outgoing: [] }),
    listCompanions: vi.fn().mockResolvedValue({ companions: [], linkableUsers: [] }),
    listNotices: vi.fn().mockResolvedValue([]),
    inboxCount: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("../../hooks/useHasLlm", () => ({ useHasLlm: () => true }));

// The summary requests a plan on mount; this suite exercises standalone notes.
vi.mock("../../lib/api/travplan", () => ({
  travplanApi: { get: vi.fn().mockResolvedValue(null) },
}));

// The documents section fetches its entry's kept originals on mount. It has
// its own suite, and `__tests__/documentsMountPoints.test.tsx` checks that
// this surface mounts it — here it would only be a request reaching the
// network, which the setup refuses (forgejo#110).
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));

vi.mock("../../lib/api", () => ({
  tripsApi: {
    getById: (...args: unknown[]) => getByIdMock(...args),
  },
}));

// The global settingsStore mock (src/__tests__/setup.ts) has no
// `enabledDomains`, which the real useEnabledDomains hook needs — stub the
// hook directly so every domain reads as enabled for this test.
// Places left the beta gate with the 2.7 line, so the trip timeline now asks
// for the trip's place visits unconditionally. Unmocked that went out as a
// real request, which the suite's network guard fails rather than prints
// (forgejo#110).
vi.mock("../../lib/api/places", () => ({
  listPlaces: () => Promise.resolve([]),
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "cruise", "lodging"], isEnabled: () => true }),
}));

const forTrip = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/notes")>()),
  notesApi: { forTrip: (...args: unknown[]) => forTrip(...args) },
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));
vi.mock("../../components/Roadtrips/useTripRoadtrips", () => ({ useTripRoadtrips: () => [] }));

import TripDetailPage from "../TripDetailPage";
import type { MemberNote, TripNotes } from "../../lib/api/notes";
import { noteFixture } from "../../components/notes/__tests__/noteFixture";

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    userId: "user-1",
    name: "Zürich Trip",
    description: null,
    color: "#818cf8",
    createdAt: "2024-05-01T00:00:00.000Z",
    updatedAt: "2024-05-01T00:00:00.000Z",
    startDate: "2024-05-13T00:00:00.000Z",
    endDate: "2024-05-15T00:00:00.000Z",
    status: "completed",
    category: null,
    tags: [],
    companions: [],
    notes: null,
    summary: null,
    originLabel: null,
    destinationLabel: null,
    coverImageUrl: null,
    icon: null,
    countries: [],
    flights: [],
    cruises: [],
    stops: [],
    journalEntries: [],
    photos: [],
    lodgingStays: [],
    ...overrides,
  };
}

async function renderTripDetail(trip: Trip): Promise<void> {
  getByIdMock.mockResolvedValue(trip);
  render(
    <MemoryRouter initialEntries={[`/trips/${trip.id}`]}>
      <Routes>
        <Route path="/trips/:id" element={<TripDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
  // Wait for the loading placeholder to clear before switching tabs.
  await screen.findByText(trip.name);
}

const memberNote: MemberNote = {
  id: "m1",
  author: { id: "u2", username: "ben", displayName: "Ben Berg" },
  body: "Bens Sonnenuntergang am See",
  placeName: "Zürichsee",
  times: {
    occurredAt: {
      utc: "2024-05-14T17:30:00.000Z",
      zone: "Europe/Zurich",
      offset: "+02:00",
      local: "2024-05-14T19:30:00",
      precision: "minute",
      zoneSource: "stored",
    },
    day: { date: "2024-05-14", zone: "Europe/Zurich", precision: "day" },
  },
};

const notes = (over: Partial<TripNotes> = {}): TripNotes => ({
  span: {
    start: { date: "2024-05-13", zone: null, precision: "day" },
    end: { date: "2024-05-15", zone: null, precision: "day" },
  },
  notes: [
    noteFixture({
      id: "own-1",
      body: "Fondue in der Altstadt",
      visibility: "shareable",
      times: {
        occurredAt: {
          utc: "2024-05-13T18:00:00.000Z",
          zone: "Europe/Zurich",
          offset: "+02:00",
          local: "2024-05-13T20:00:00",
          precision: "minute",
          zoneSource: "stored",
        },
        day: { date: "2024-05-13", zone: "Europe/Zurich", precision: "day" },
      },
    }),
  ],
  memberNotes: [memberNote],
  truncated: false,
  ...over,
});

async function openTimeline(): Promise<void> {
  await renderTripDetail(makeTrip());
  await userEvent.click(screen.getByText("trips:detail.tabs.timeline"));
}

describe("TripDetailPage — notes on the trip's days", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks for this trip's notes and shows the reader's own note on its own clock", async () => {
    forTrip.mockResolvedValue(notes());
    await openTimeline();
    expect(forTrip).toHaveBeenCalledWith("trip-1");
    const own = await screen.findByText("Fondue in der Altstadt");
    const card = own.closest("div.rounded-xl") as HTMLElement;
    // 20:00 in Zürich — the clock it was written on, not the reader's.
    expect(within(card).getByText(/20:00/)).toBeInTheDocument();
  });

  it("opens the note editor on the reader's own note", async () => {
    forTrip.mockResolvedValue(notes());
    await openTimeline();
    await userEvent.click(await screen.findByText("Fondue in der Altstadt"));
    await userEvent.click(screen.getByRole("button", { name: "notes:card.edit" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Fondue in der Altstadt")).toBeInTheDocument();
  });

  it("shows another member's shareable note read-only, with its author", async () => {
    forTrip.mockResolvedValue(notes());
    await openTimeline();
    await userEvent.click(await screen.findByText("Bens Sonnenuntergang am See"));
    expect(screen.getByText("trips:detail.timeline.note.memberHint")).toBeInTheDocument();
    const card = screen
      .getByText("trips:detail.timeline.note.memberHint")
      .closest("div.rounded-xl") as HTMLElement;
    expect(within(card).queryByRole("button", { name: "notes:card.edit" })).toBeNull();
  });

  it("says the notes could not be loaded, keeps the rest of the timeline, and retries", async () => {
    forTrip.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(notes());
    await openTimeline();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("trips:detail.timeline.note.loadFailed");
    await userEvent.click(within(alert).getByRole("button"));
    expect(await screen.findByText("Fondue in der Altstadt")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when the server cut the list", async () => {
    forTrip.mockResolvedValue(notes({ truncated: true }));
    await openTimeline();
    expect(await screen.findByText("trips:detail.timeline.note.truncated")).toBeInTheDocument();
  });
});
