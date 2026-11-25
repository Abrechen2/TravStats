import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { SPOOL_DIR } from "./spool";
import type { MappedTrack } from "./trackFile";

/**
 * A file import's points on disk (2026-11-24): the file is parsed once, before
 * the import waits for its write turn, and its points go to an NDJSON file next
 * to the upload (mode 0600). The batches are read back from there at the
 * import's cursor, so an import waiting for its turn holds no points and a turn
 * given away costs no second parse. In memory stays one byte offset per point.
 * The caller removes the file when the import ends, however it ends.
 */

/** Points turned into lines per write. */
const WRITE_CHUNK = 5_000;

export type PointSpool = {
  path: string;
  count: number;
  /** The points `[at, at + size)`, as the track handed them out. */
  batch: (at: number, size: number) => Promise<Record<string, unknown>[]>;
  /** Removes the file; safe to call twice. */
  discard: () => Promise<void>;
};

export async function spoolPoints(track: MappedTrack): Promise<PointSpool> {
  fs.mkdirSync(SPOOL_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(SPOOL_DIR, `${randomUUID()}.points.ndjson`);
  const offsets = new Float64Array(track.count + 1);
  const out = await fs.promises.open(file, "wx", 0o600);
  try {
    let pos = 0;
    for (let at = 0; at < track.count; at += WRITE_CHUNK) {
      const lines = track.batch(at, WRITE_CHUNK).map((p) => `${JSON.stringify(p)}\n`);
      lines.forEach((line, k) => {
        offsets[at + k] = pos;
        pos += Buffer.byteLength(line);
      });
      await out.write(lines.join(""));
    }
    offsets[track.count] = pos;
  } catch (err) {
    await out.close();
    await fs.promises.rm(file, { force: true });
    throw err;
  }
  await out.close();
  return {
    path: file,
    count: track.count,
    batch: async (at, size) => {
      const from = Math.max(0, Math.min(at, track.count));
      const until = Math.min(track.count, from + size);
      if (until <= from) return [];
      const start = offsets[from];
      const length = offsets[until] - start;
      const buf = Buffer.alloc(length);
      const fd = await fs.promises.open(file, "r");
      try {
        await fd.read(buf, 0, length, start);
      } finally {
        await fd.close();
      }
      return buf
        .toString("utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    discard: () => fs.promises.rm(file, { force: true }),
  };
}
