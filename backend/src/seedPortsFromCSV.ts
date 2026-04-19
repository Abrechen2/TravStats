import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { prisma } from './db';
import logger from './utils/logger';

interface CSVPort {
  name: string;
  city: string;
  country: string;
  unlocode: string;
  lat: string;
  lon: string;
  timezone: string;
  region: string;
}

const CSV_PATH = path.resolve(__dirname, 'seedData', 'ports.csv');

export async function seedPortsFromCSV(): Promise<number> {
  if (!fs.existsSync(CSV_PATH)) {
    logger.warn({ operation: 'seed_ports_skip', reason: 'csv_missing', path: CSV_PATH });
    return 0;
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as CSVPort[];

  let inserted = 0;
  for (const row of rows) {
    if (!row.name || !row.lat || !row.lon) continue;

    const unlocode = row.unlocode?.trim() || null;
    if (unlocode) {
      const existing = await prisma.port.findUnique({ where: { unlocode } });
      if (existing) continue;
    }

    await prisma.port.create({
      data: {
        name: row.name.trim(),
        city: row.city?.trim() || null,
        country: row.country?.trim() || null,
        unlocode,
        lat: Number.parseFloat(row.lat),
        lon: Number.parseFloat(row.lon),
        timezone: row.timezone?.trim() || null,
        region: row.region?.trim() || null,
        isUserAdded: false,
      },
    });
    inserted += 1;
  }

  logger.info({ operation: 'seed_ports_done', inserted });
  return inserted;
}
