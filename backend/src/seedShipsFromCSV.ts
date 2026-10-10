import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { prisma } from "./db";
import logger from "./utils/logger";

interface CSVShip {
  name: string;
  imo: string;
  cruise_line: string;
  year_built: string;
  gross_tonnage: string;
  capacity: string;
  status: string;
  /** "ocean" | "river" (#359); an absent column means ocean. */
  kind?: string;
}

const CSV_PATH = path.resolve(__dirname, "seedData", "ships.csv");

const toIntOrNull = (v: string): number | null => {
  if (!v || v.trim() === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

export async function seedShipsFromCSV(): Promise<number> {
  if (!fs.existsSync(CSV_PATH)) {
    logger.warn({ operation: "seed_ships_skip", reason: "csv_missing", path: CSV_PATH });
    return 0;
  }

  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as CSVShip[];

  let inserted = 0;
  for (const row of rows) {
    if (!row.name || !row.cruise_line) continue;

    const imo = row.imo?.trim() || null;
    if (imo) {
      const existing = await prisma.ship.findUnique({ where: { imo } });
      if (existing) continue;
    } else {
      // River ships rarely carry an IMO number (they are registered by ENI),
      // so a row without one is matched by name + line instead — otherwise
      // every boot would seed it again.
      const existing = await prisma.ship.findFirst({
        where: {
          imo: null,
          name: { equals: row.name.trim(), mode: "insensitive" },
          cruiseLine: { equals: row.cruise_line.trim(), mode: "insensitive" },
        },
        select: { id: true },
      });
      if (existing) continue;
    }
    const kind = row.kind?.trim() === "river" ? "river" : "ocean";

    await prisma.ship.create({
      data: {
        name: row.name.trim(),
        imo,
        cruiseLine: row.cruise_line.trim(),
        yearBuilt: toIntOrNull(row.year_built),
        grossTonnage: toIntOrNull(row.gross_tonnage),
        capacity: toIntOrNull(row.capacity),
        status: row.status?.trim() || "active",
        kind,
        isUserAdded: false,
      },
    });
    inserted += 1;
  }

  logger.info({ operation: "seed_ships_done", inserted });
  return inserted;
}
