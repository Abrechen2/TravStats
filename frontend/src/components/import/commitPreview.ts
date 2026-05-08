import { api } from "../../lib/api/client";
import { logger } from "../../lib/logger";
import type { PreviewRowEnriched } from "../../lib/api/import";

const CHUNK_SIZE = 20;

export interface CommitChunkFailure {
  chunkIndex: number;
  error: string;
}

export interface CommitResult {
  committed: number;
  failures: CommitChunkFailure[];
}

export async function commitPreviewRows(
  rows: PreviewRowEnriched[],
  dataSource: "imported_fr24" | "imported_generic_csv",
): Promise<CommitResult> {
  const failures: CommitChunkFailure[] = [];
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
    const chunkIndex = Math.floor(i / CHUNK_SIZE);
    try {
      await api.post("/flights/batch", payload);
      committed += chunk.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("import_commit_chunk_failed", { chunkIndex, dataSource, message });
      failures.push({ chunkIndex, error: message });
    }
  }

  return { committed, failures };
}
