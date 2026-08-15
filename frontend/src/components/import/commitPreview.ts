import { api } from "../../lib/api/client";
import { logger } from "../../lib/logger";
import { createImportBatch } from "../../lib/api/importBatches";
import type { PreviewRowEnriched } from "../../lib/api/import";

const CHUNK_SIZE = 20;

export interface CommitChunkFailure {
  chunkIndex: number;
  error: string;
}

export interface CommitResult {
  committed: number;
  /** Rows the server already had from an earlier import of the same file. */
  skipped: number;
  failures: CommitChunkFailure[];
}

/**
 * Writes the reviewed rows, as ONE import the user can take back.
 *
 * The batch is created first and its id rides along on every chunk, so twenty
 * rows at a time still add up to a single entry in the import log. Without it
 * a flight logbook import left no trace at all: the log said "nothing imported
 * yet" while 160 flights had just landed, and there was no way to undo them.
 *
 * The server reports how many rows it already had — importing the same export
 * twice is a normal thing to do, and "12 added, 148 already here" is the
 * answer, not 148 duplicates.
 */
export async function commitPreviewRows(
  rows: PreviewRowEnriched[],
  dataSource: "imported_fr24" | "imported_generic_csv",
  fileName?: string | null
): Promise<CommitResult> {
  const failures: CommitChunkFailure[] = [];
  let committed = 0;
  let skipped = 0;

  // A batch that cannot be created must not cost the user their import: the
  // rows still go in, they just land without an undo record.
  let batchId: string | null = null;
  try {
    batchId = await createImportBatch("flight", "csv", fileName ?? null);
  } catch (err) {
    logger.error("import_batch_create_failed", { dataSource, err });
  }
  const query = batchId ? `?batchId=${encodeURIComponent(batchId)}` : "";

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
      const res = await api.post<{ count?: number; skipped?: number }>(
        `/flights/batch${query}`,
        payload
      );
      committed += res.data?.count ?? chunk.length;
      skipped += res.data?.skipped ?? 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("import_commit_chunk_failed", { chunkIndex, dataSource, message });
      failures.push({ chunkIndex, error: message });
    }
  }

  return { committed, skipped, failures };
}
