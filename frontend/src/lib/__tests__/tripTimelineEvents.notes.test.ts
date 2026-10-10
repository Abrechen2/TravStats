import { describe, it, expect } from "vitest";
import { buildTimelineEvents } from "../tripTimelineEvents";
import type { Trip } from "../../types";
import type { TripNotes } from "../api/notes";
import { noteFixture } from "../../components/notes/__tests__/noteFixture";

/**
 * Standalone notes on the trip timeline (forgejo#146): each at its moment on
 * the clock it was written on, grouped by its own day; a note dated to the
 * day only closes its day like a diary entry, instead of opening it at a
 * made-up midnight.
 */
type TripFlight = NonNullable<Trip["flights"]>[number];

const flight = {
  id: "f1",
  depIata: "FRA",
  arrIata: "LIS",
  times: {
    departure: {
      utc: "2025-05-03T08:00:00.000Z",
      zone: "Europe/Berlin",
      offset: "+02:00",
      local: "2025-05-03T10:00:00",
      precision: "minute",
    },
    arrival: {
      utc: "2025-05-03T11:00:00.000Z",
      zone: "Europe/Lisbon",
      offset: "+01:00",
      local: "2025-05-03T12:00:00",
      precision: "minute",
    },
  },
} as TripFlight;

const trip = {
  id: "t1",
  flights: [flight],
  cruises: [],
  stops: [],
  journalEntries: [],
} as unknown as Trip;

const timed = noteFixture({
  id: "timed",
  body: "Before boarding",
  times: {
    occurredAt: {
      utc: "2025-05-03T07:00:00.000Z",
      zone: "Europe/Berlin",
      offset: "+02:00",
      local: "2025-05-03T09:00:00",
      precision: "minute",
    },
    day: { date: "2025-05-03", zone: "Europe/Berlin", precision: "day" },
  },
});

const dayOnly = noteFixture({
  id: "day",
  body: "A good day",
  occurredPrecision: "day",
  times: {
    occurredAt: {
      utc: "2025-05-02T23:00:00.000Z",
      zone: "Europe/Lisbon",
      offset: "+01:00",
      local: "2025-05-03T00:00:00",
      precision: "day",
    },
    day: { date: "2025-05-03", zone: "Europe/Lisbon", precision: "day" },
  },
});

const notes: TripNotes = {
  span: null,
  notes: [dayOnly, timed],
  memberNotes: [
    {
      id: "m1",
      author: { id: "u2", username: "ben", displayName: "Ben" },
      body: "At the gate",
      placeName: null,
      times: {
        occurredAt: {
          utc: "2025-05-03T07:30:00.000Z",
          zone: "Europe/Berlin",
          offset: "+02:00",
          local: "2025-05-03T09:30:00",
          precision: "minute",
        },
        day: { date: "2025-05-03", zone: "Europe/Berlin", precision: "day" },
      },
    },
  ],
  truncated: false,
};

describe("notes on the trip timeline", () => {
  it("orders them with the trip's entries by moment; a day-only note closes its day", () => {
    const events = buildTimelineEvents(trip, [], notes);
    expect(events.map((e) => e.id)).toEqual([
      "note-timed",
      "member-note-m1",
      "flight-f1",
      "note-day",
    ]);
    const member = events.find((e) => e.id === "member-note-m1");
    expect(member?.kind === "note" && member.mine).toBe(false);
  });

  it("adds nothing while the notes are not loaded", () => {
    expect(buildTimelineEvents(trip, [], null).map((e) => e.id)).toEqual(["flight-f1"]);
  });
});
