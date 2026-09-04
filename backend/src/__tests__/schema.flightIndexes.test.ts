import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * forgejo#48 — every statistics query filters flights on (userId, status)
 * and most order by departureTime, and the table had ten single-column
 * indexes and no composite one. The composite index arrived with migration
 * 20260901105656; nothing checked that it stays. A schema edit that drops
 * an @@index line is a one-line diff nobody reads twice.
 */
const schema = readFileSync(join(__dirname, "..", "..", "prisma", "schema.prisma"), "utf8");
const migrations = readdirSync(join(__dirname, "..", "..", "prisma", "migrations"));

function modelBlock(name: string): string {
  const m = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`model ${name} not found in schema.prisma`);
  return m[1];
}

describe("Flight indexes (forgejo#48)", () => {
  it("keeps the composite (userId, status, departureTime) index the stats queries filter on", () => {
    expect(modelBlock("Flight")).toMatch(/@@index\(\[userId, status, departureTime\]\)/);
  });

  it("has the migration that created it", () => {
    expect(migrations.some((d) => d.includes("flight_user_status_time_indexes"))).toBe(true);
  });
});
