import type { Note } from "../../../lib/api/notes";

/** A note as the server answers it: 00:30 in Berlin on the 28th, i.e. the 27th in UTC. */
export function noteFixture(over: Partial<Note> = {}): Note {
  return {
    id: "n1",
    body: "Erster Schnee auf dem Wendelstein.",
    occurredAt: "2026-09-27T22:30:00.000Z",
    occurredZone: "Europe/Berlin",
    occurredPrecision: "minute",
    placeName: null,
    lat: null,
    lon: null,
    photo: null,
    createdAt: "2026-09-27T22:31:00.000Z",
    updatedAt: "2026-09-27T22:31:00.000Z",
    times: {
      occurredAt: {
        utc: "2026-09-27T22:30:00.000Z",
        zone: "Europe/Berlin",
        offset: "+02:00",
        local: "2026-09-28T00:30:00",
        precision: "minute",
        zoneSource: "stored",
      },
      day: { date: "2026-09-28", zone: "Europe/Berlin", precision: "day" },
    },
    ...over,
  };
}
