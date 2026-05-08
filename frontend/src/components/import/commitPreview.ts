import { api } from "../../lib/api/client";
import type { PreviewRowEnriched } from "../../lib/api/import";

const CHUNK_SIZE = 20;

export async function commitPreviewRows(
  rows: PreviewRowEnriched[],
  dataSource: "imported_fr24" | "imported_generic_csv",
): Promise<{ committed: number; failedChunks: number[] }> {
  const failedChunks: number[] = [];
  let committed = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const payload = chunk.map((r) => ({
      airline: r.airline,
      flightNumber: r.flightNumberNormalised,
      aircraft: r.aircraft,
      aircraftRegistration: r.registration,
      departure: { iata: r.fromIata, name: "", lat: r.depLat, lon: r.depLon },
      arrival: { iata: r.toIata, name: "", lat: r.arrLat, lon: r.arrLon },
      departureLocal: `${r.date}T${r.depTimeLocal ?? "00:00:00"}`,
      arrivalLocal: r.arrivalLocalCorrected,
      depTimezone: r.depTimezone,
      arrTimezone: r.arrTimezone,
      seatNumber: r.seatNumber,
      seatClass: r.seatClass,
      category: r.category,
      notes: r.notes,
      status: r.statusDefault,
      dataSource,
    }));
    try {
      await api.post("/flights/batch", payload);
      committed += chunk.length;
    } catch {
      failedChunks.push(i / CHUNK_SIZE);
    }
  }

  return { committed, failedChunks };
}
