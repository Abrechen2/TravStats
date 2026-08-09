import { describe, it, expect } from "vitest";
import { buildFlightsWorkbook, parseXlsxBufferToRows } from "../xlsxRoundTrip";
import type { Flight } from "../../types";

/**
 * Tripwire for the companions Excel round trip.
 *
 * `xlsxRoundTrip.ts` exports flights to a spreadsheet and re-imports them,
 * and it handles companions as a single comma-joined TEXT column
 * (`(f.companions ?? []).join(", ")` on export, read back verbatim on
 * import — there is no `rowToFlight`/split step in this module today).
 * That string-based contract is the reason the companion-entity feature
 * kept the API shape as `companions: string[]` instead of switching to
 * companion ids: the moment the backend stops accepting plain names,
 * Excel import breaks. This file pins that contract so a future change
 * to the export/import format fails here loudly instead of silently.
 */

async function flightsToBuffer(flights: Flight[]): Promise<ArrayBuffer> {
  const wb = await buildFlightsWorkbook(flights);
  // exceljs typings differ between node Buffer and ArrayBuffer; coerce here.
  const out = (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;
  return out;
}

// Minimal valid Flight fixture — only the required fields from the Flight
// type plus whatever the test overrides.
const baseFlight: Flight = {
  id: "f1",
  userId: "u1",
  airline: "Lufthansa",
  flightNumber: "LH400",
  depLat: 50.0264,
  depLon: 8.5431,
  arrLat: 40.6413,
  arrLon: -73.7781,
  departureTime: "2026-04-01T09:30:00Z",
  arrivalTime: "2026-04-01T18:45:00Z",
  status: "scheduled",
  createdAt: "2026-04-01T05:00:00Z",
};

describe("companions survive the Excel round trip", () => {
  it("exports and re-imports a plain name list unchanged, in the same order", async () => {
    const original = ["Anna Muller", "Jonas"];
    const flight: Flight = { ...baseFlight, companions: original };

    const buffer = await flightsToBuffer([flight]);
    const rows = await parseXlsxBufferToRows(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0].companions).toBe("Anna Muller, Jonas");
    // Splitting on the join separator reconstructs the original array —
    // this is the shape any future rowToFlight-style import step would rely on.
    expect(rows[0].companions.split(", ")).toEqual(original);
  });

  it("preserves diacritics byte-identically (the backend deliberately does not normalise names)", async () => {
    const original = ["Anna Müller", "François Bjørk"];
    const flight: Flight = { ...baseFlight, companions: original };

    const buffer = await flightsToBuffer([flight]);
    const rows = await parseXlsxBufferToRows(buffer);

    expect(rows[0].companions).toBe("Anna Müller, François Bjørk");
    expect(rows[0].companions.split(", ")).toEqual(original);
  });

  it("PRE-EXISTING LIMITATION: a comma inside a companion name is indistinguishable from the join separator", async () => {
    // Companions are comma-joined into one cell. A name that itself contains
    // ", " collides with the separator used to join the list, so the exact
    // sequence of characters survives the round trip (nothing is dropped or
    // corrupted at the byte level) but the ORIGINAL ARRAY BOUNDARIES are
    // lost: re-splitting on ", " yields more entries than were exported.
    // This is a real, pre-existing gap in the comma-joined text format —
    // not something to fix in this task. Flagging for the owner to decide
    // whether the companion-entity work should special-case it (e.g. a
    // different in-cell delimiter) once companions become a real entity.
    const original = ["Smith, Jr.", "Jonas"];
    const flight: Flight = { ...baseFlight, companions: original };

    const buffer = await flightsToBuffer([flight]);
    const rows = await parseXlsxBufferToRows(buffer);

    // The raw cell text is exactly the naive join — no data is dropped.
    expect(rows[0].companions).toBe("Smith, Jr., Jonas");

    // But re-splitting on the same separator does NOT recover the original
    // two-entry array — it produces three entries, silently splitting
    // "Smith, Jr." into "Smith" and "Jr.". This documents the real,
    // observable behavior of the current format.
    expect(rows[0].companions.split(", ")).toEqual(["Smith", "Jr.", "Jonas"]);
    expect(rows[0].companions.split(", ")).not.toEqual(original);
  });
});
