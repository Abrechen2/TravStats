import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Perf audit 2026-11, item 7: the index re-check is a script the owner runs on
 * prod in a week. It must run as written, read-only, against the current schema.
 */
const SCRIPT = path.join(__dirname, "../../../scripts/ops/travtrack-index-usage.sql");

it("runs every statement of the index-usage report and lists the TravTrack indexes", async () => {
  const statements = fs
    .readFileSync(SCRIPT, "utf-8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  expect(statements.every((s) => /^SELECT\b/i.test(s))).toBe(true);
  const results: unknown[][] = [];
  for (const s of statements) results.push((await prisma.$queryRawUnsafe(s)) as unknown[]);
  const names = (results[1] as Array<{ index_name: string }>).map((r) => r.index_name);
  expect(names).toContain("travtrack_points_user_id_origin_t_idx");
});
