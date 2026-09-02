/**
 * One-off: re-measure the country count against the owner's real data.
 *
 * The whole rework started because the owner said his count looked too high.
 * The design withdrew its own estimates as impossible (a lower threshold cannot
 * yield fewer countries), so the only honest answer is to run the SHIPPED rule
 * over the real rows — not a re-implementation of it, which would measure my
 * reading of the code rather than the code.
 *
 * Input is a read-only extract from the RC mirror: country codes, dates and
 * statuses. No names, no addresses, no flight numbers. Nothing is written
 * anywhere; this only prints.
 *
 * Run:
 *   npx tsx src/scripts/measureCountryRework.ts <extract.txt> <places.txt> <airports.txt>
 */
import { readFileSync } from "fs";

import { buildPassport, type PassportFlight } from "../services/stats/passport";
import { isoCountryCode } from "../utils/continents";

type Section = Record<string, string[]>;

/** Split a psql `\echo @@NAME`-delimited dump into its sections. */
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
    if (line.startsWith("psql:") || line.startsWith("LINE ") || line.startsWith("ERROR")) continue;
    if (line.includes("Field separator") || line.includes("Output format")) continue;
    out[current]?.push(line);
  }
  return out;
}

const parseDate = (s: string): Date | null => {
  const t = s.trim();
  if (!t) return null;
  const d = new Date(t.replace(" ", "T") + (t.includes("+") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? null : d;
};

const [, , extractPath, placesPath, airportsPath] = process.argv;
if (!extractPath || !placesPath || !airportsPath) {
  throw new Error("usage: measureCountryRework <extract> <places> <airports>");
}

const ex = sections(readFileSync(extractPath, "utf8"));
const pl = sections(readFileSync(placesPath, "utf8"));
const ap = sections(readFileSync(airportsPath, "utf8"));

// --- airports -------------------------------------------------------------
const airportCountry = new Map<string, string>();
const airportLat = new Map<string, number>();
const airportLon = new Map<string, number>();
for (const row of ap.AIRPORTS2 ?? []) {
  const [iata, country, lat, lon] = row.split("|");
  if (!iata) continue;
  if (country) airportCountry.set(iata, country);
  airportLat.set(iata, Number(lat) || 0);
  airportLon.set(iata, Number(lon) || 0);
}

// --- flights --------------------------------------------------------------
const flights: PassportFlight[] = [];
for (const row of ex.FLIGHTS ?? []) {
  const [dep, arr, depTime, , status] = row.split("|");
  flights.push({
    depIata: dep || null,
    depLat: airportLat.get(dep ?? "") ?? 0,
    depLon: airportLon.get(dep ?? "") ?? 0,
    arrIata: arr || null,
    arrLat: airportLat.get(arr ?? "") ?? 0,
    arrLon: airportLon.get(arr ?? "") ?? 0,
    departureTime: parseDate(depTime ?? ""),
    status: (status ?? "").trim(),
  } as PassportFlight);
}

// --- lodgings + their stays ----------------------------------------------
const stays = new Map<string, { checkIn: Date | null; checkOut: Date | null; status: string }[]>();
for (const row of ex.STAYS ?? []) {
  const [lodgingId, checkIn, checkOut, status] = row.split("|");
  if (!lodgingId) continue;
  const list = stays.get(lodgingId) ?? [];
  list.push({
    checkIn: parseDate(checkIn ?? ""),
    checkOut: parseDate(checkOut ?? ""),
    status: (status ?? "completed").trim() || "completed",
  });
  stays.set(lodgingId, list);
}

const lodgings = (ex.LODGINGS ?? []).flatMap((row) => {
  const [id, iso, country, visited] = row.split("|");
  if (!id || (visited ?? "").trim() !== "t") return [];
  const code = (iso ?? "").trim() || (country ?? "").trim();
  if (!code) return [];
  return [{ lodgingId: id, name: "", isoCountryCode: code, stays: stays.get(id) ?? [] }];
});

// --- places and ports -----------------------------------------------------
const placeVisits = (pl.PLACES ?? []).flatMap((row) => {
  const [iso, country, at] = row.split("|");
  const code = (iso ?? "").trim() || (country ?? "").trim();
  if (!code) return [];
  return [{ placeId: "", name: "", isoCountryCode: code, at: parseDate(at ?? "") }];
});

const portCalls = (ex.PORTS ?? []).flatMap((row) => {
  const [country, arrival, departure] = row.split("|");
  if (!(country ?? "").trim()) return [];
  return [
    {
      cruiseId: "",
      portName: "",
      country: country.trim(),
      at: parseDate(arrival ?? "") ?? parseDate(departure ?? ""),
    },
  ];
});

// --- the OLD rule, as `buildPassport` implemented it before the rework -----
// "a country counts if a flight began OR ended there", plus ports and places.
// Lodging was not a parameter at all. Reproduced here only to name the delta.
const FLOWN = new Set(["flown", "historical"]);
const oldCountries = new Set<string>();
for (const f of flights) {
  if (!FLOWN.has(f.status)) continue;
  for (const iata of [f.depIata, f.arrIata]) {
    const code = isoCountryCode(airportCountry.get(iata ?? "") ?? null);
    if (code) oldCountries.add(code);
  }
}
for (const p of portCalls) {
  const code = isoCountryCode(p.country);
  if (code) oldCountries.add(code);
}
for (const v of placeVisits) {
  const code = isoCountryCode(v.isoCountryCode);
  if (code) oldCountries.add(code);
}

// --- the NEW rule, from the shipped module --------------------------------
const now = new Date();
const passport = buildPassport(
  flights,
  airportCountry,
  [],
  now,
  portCalls,
  placeVisits,
  lodgings
);

const rows = passport.countries;
const byCode = new Map(rows.map((c) => [c.code, c]));
const newCounted = new Set(rows.filter((c) => c.counted).map((c) => c.code));

const name = (code: string) =>
  new Intl.DisplayNames(["de"], { type: "region" }).of(code) ?? code;

console.log("=".repeat(72));
console.log("INPUT   flights", flights.length, " lodgings", lodgings.length,
  " stays", [...stays.values()].reduce((n, s) => n + s.length, 0),
  " places", placeVisits.length, " ports", portCalls.length);
console.log("OLD rule (flight began or ended there, + ports + places):", oldCountries.size);
console.log("NEW rule, headline at threshold", `"${passport.summary.countryThreshold}"`,
  ":", passport.summary.countries);
console.log("NEW rule, every country with evidence:", passport.summary.countriesTotal);
console.log("byTier:", JSON.stringify(passport.summary.byTier));
console.log("byEvidence:", JSON.stringify(passport.summary.byEvidence));

const added = [...newCounted].filter((c) => !oldCountries.has(c)).sort();
const removed = [...oldCountries].filter((c) => !newCounted.has(c)).sort();

console.log("\n--- GAINED (" + added.length + ") — counted now, not before ---");
for (const code of added) {
  const r = byCode.get(code);
  console.log(`  ${code} ${name(code).padEnd(24)} tier=${r?.tier} kinds=${r?.kinds?.join(",")}` +
    ` days=${r?.daysPresent} undated=${r?.hasUndatedEvidence}`);
}

console.log("\n--- LOST (" + removed.length + ") — counted before, not now ---");
for (const code of removed) {
  const r = byCode.get(code);
  console.log(`  ${code} ${name(code).padEnd(24)} ` +
    (r ? `still listed, tier=${r.tier} counted=${r.counted} kinds=${r.kinds.join(",")}`
       : "no longer has any evidence"));
}

console.log("\n--- every country NOT counted at this threshold (must still be listed) ---");
for (const r of rows.filter((c) => !c.counted)) {
  console.log(`  ${r.code} ${name(r.code).padEnd(24)} tier=${r.tier} kinds=${r.kinds.join(",")}`);
}
