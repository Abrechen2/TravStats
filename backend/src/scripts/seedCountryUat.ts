/**
 * One-off: load the read-only RC extract into a LOCAL scratch database so the
 * country rework can be exercised through the real UI on real-shaped data.
 *
 * Deliberately local-only. The extract carries country codes, dates and
 * statuses — no names, no addresses, no flight numbers — and every hotel and
 * place is seeded under a synthetic name, so nothing identifying leaves the
 * measurement. NEVER point this at the shared dev database or at any server.
 *
 * Run:
 *   DATABASE_URL=...flights_ce_uat npx tsx src/scripts/seedCountryUat.ts \
 *     /tmp/rc-extract.txt /tmp/rc-places.txt /tmp/rc-airports.txt
 */
import { readFileSync } from "fs";

import bcrypt from "bcrypt";

import { prisma } from "../db";

type Section = Record<string, string[]>;

function sections(text: string): Section {
  const out: Section = {};
  let current: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("@@")) {
      current = line.slice(2);
      if (current !== "END") out[current] = [];
      continue;
    }
    if (!current || current === "END" || !line) continue;
    if (/^(psql:|LINE |ERROR)/.test(line)) continue;
    if (line.includes("Field separator") || line.includes("Output format")) continue;
    out[current]?.push(line);
  }
  return out;
}

const parseDate = (s: string): Date | null => {
  const t = (s ?? "").trim();
  if (!t) return null;
  const d = new Date(t.replace(" ", "T") + (t.includes("+") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? null : d;
};

async function main(): Promise<void> {
  const [, , extractPath, placesPath, airportsPath] = process.argv;
  if (!extractPath || !placesPath || !airportsPath) {
    throw new Error("usage: seedCountryUat <extract> <places> <airports>");
  }
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("flights_ce_uat")) {
    throw new Error(`refusing to seed: DATABASE_URL must name flights_ce_uat, got "${url}"`);
  }

  const ex = sections(readFileSync(extractPath, "utf8"));
  const pl = sections(readFileSync(placesPath, "utf8"));
  const ap = sections(readFileSync(airportsPath, "utf8"));

  const user = await prisma.user.upsert({
    where: { username: "uat" },
    update: { passwordHash: bcrypt.hashSync("uat12345", 10), mustChangePassword: false },
    create: {
      username: "uat",
      passwordHash: bcrypt.hashSync("uat12345", 10),
      mustChangePassword: false,
      isAdmin: true,
    },
  });
  console.log("user:", user.username, user.id);

  // --- airports ----------------------------------------------------------
  const lat = new Map<string, number>();
  const lon = new Map<string, number>();
  const airportRows = (ap.AIRPORTS2 ?? []).flatMap((row) => {
    const [iata, country, la, lo, tz] = row.split("|");
    if (!iata) return [];
    lat.set(iata, Number(la) || 0);
    lon.set(iata, Number(lo) || 0);
    return [
      {
        iata,
        name: iata,
        lat: Number(la) || 0,
        lon: Number(lo) || 0,
        country: (country ?? "").trim() || null,
        timezone: (tz ?? "").trim() || null,
      },
    ];
  });
  await prisma.airport.deleteMany({});
  await prisma.airport.createMany({ data: airportRows, skipDuplicates: true });
  console.log("airports:", airportRows.length);

  // --- flights -----------------------------------------------------------
  await prisma.flight.deleteMany({ where: { userId: user.id } });
  const flights = (ex.FLIGHTS ?? []).map((row, i) => {
    const [dep, arr, depTime, arrTime, status] = row.split("|");
    return {
      userId: user.id,
      flightNumber: `UAT${i}`,
      depIata: dep || null,
      arrIata: arr || null,
      depLat: lat.get(dep ?? "") ?? 0,
      depLon: lon.get(dep ?? "") ?? 0,
      arrLat: lat.get(arr ?? "") ?? 0,
      arrLon: lon.get(arr ?? "") ?? 0,
      departureTime: parseDate(depTime ?? ""),
      arrivalTime: parseDate(arrTime ?? ""),
      status: (status ?? "flown").trim() || "flown",
    };
  });
  await prisma.flight.createMany({ data: flights });
  console.log("flights:", flights.length);

  // --- lodgings + stays --------------------------------------------------
  await prisma.lodgingStay.deleteMany({ where: { userId: user.id } });
  await prisma.lodging.deleteMany({ where: { userId: user.id } });
  const idMap = new Map<string, string>();
  let n = 0;
  for (const row of ex.LODGINGS ?? []) {
    const [id, iso, country, visited] = row.split("|");
    if (!id) continue;
    const created = await prisma.lodging.create({
      data: {
        userId: user.id,
        type: "hotel",
        name: `Unterkunft ${++n}`,
        country: (country ?? "").trim() || null,
        isoCountryCode: (iso ?? "").trim() || null,
        visited: (visited ?? "").trim() === "t",
      },
    });
    idMap.set(id, created.id);
  }
  console.log("lodgings:", idMap.size);

  const stayRows = (ex.STAYS ?? []).flatMap((row) => {
    const [lodgingId, checkIn, checkOut, status] = row.split("|");
    const mapped = idMap.get(lodgingId ?? "");
    if (!mapped) return [];
    return [
      {
        userId: user.id,
        lodgingId: mapped,
        checkIn: parseDate(checkIn ?? ""),
        checkOut: parseDate(checkOut ?? ""),
        status: (status ?? "completed").trim() || "completed",
      },
    ];
  });
  await prisma.lodgingStay.createMany({ data: stayRows });
  console.log("stays:", stayRows.length);

  // --- places ------------------------------------------------------------
  await prisma.placeVisit.deleteMany({ where: { userId: user.id } });
  await prisma.place.deleteMany({ where: { userId: user.id } });
  let p = 0;
  for (const row of pl.PLACES ?? []) {
    const [iso, country, at] = row.split("|");
    const place = await prisma.place.create({
      data: {
        userId: user.id,
        name: `Ort ${++p}`,
        lat: 0,
        lon: 0,
        country: (country ?? "").trim() || null,
        isoCountryCode: (iso ?? "").trim() || null,
      },
    });
    await prisma.placeVisit.create({
      data: { userId: user.id, placeId: place.id, visitedAt: parseDate(at ?? "") },
    });
  }
  console.log("places:", p);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
