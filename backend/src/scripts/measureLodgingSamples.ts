/**
 * Measures the Booking.com template against a folder of REAL confirmations,
 * using the same extraction path as `/parse-email-file`. Offline by design: no
 * Ollama, no database. It answers one question — how far does the template
 * carry a real inbox, and which field is the next one worth fixing?
 *
 *   cd backend && npx tsx src/scripts/measureLodgingSamples.ts
 *
 * The samples are the owner's private mail and are gitignored, so this prints
 * a summary and per-file field gaps; run it after any change to the template.
 * Baseline 2026-08-13, 95 samples: 71/95 hits before the stacked-layout fix,
 * 93/95 after (the 2 misses are direct hotel bookings, which belong to the LLM
 * path by design). Price coverage across those hits was 87/93 until the amount
 * parser stopped recognising only four currencies; since the ISO-4217 work it
 * is 93/93 — the NOK, AUD, SGD and US$ bookings now carry their totals.
 */
import * as fs from "fs";
import * as path from "path";
import { extractEmailFromFile } from "../services/emailExtractor";
import {
  isBookingComConfirmation,
  parseBookingComEmail,
} from "../services/lodging/bookingComTemplate";

const DIR =
  process.env.SAMPLE_DIR ?? path.resolve(__dirname, "../../..", "test-samples", "Hotel Buchungen");

if (!fs.existsSync(DIR)) {
  console.log(`No sample folder at ${DIR} — set SAMPLE_DIR to point at one. Nothing to measure.`);
  process.exit(0);
}

interface Row {
  file: string;
  matched: boolean;
  hotel: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  city: string | null;
  country: string | null;
  postcode: string | null;
  address: string | null;
  price: number | null;
  currency: string | null;
  ref: string | null;
  room: string | null;
  textLen: number;
}

function firstLineAsSubject(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.toLowerCase().endsWith(".msg") || f.toLowerCase().endsWith(".eml"))
  .sort();

const rows: Row[] = [];

for (const f of files) {
  const buf = fs.readFileSync(path.join(DIR, f));
  let extracted;
  try {
    extracted = extractEmailFromFile(buf, f);
  } catch (err) {
    rows.push({
      file: f,
      matched: false,
      hotel: `EXTRACT FAILED: ${err instanceof Error ? err.message : String(err)}`,
      checkIn: null, checkOut: null, nights: null, city: null, country: null,
      postcode: null, address: null, price: null, currency: null, ref: null,
      room: null, textLen: 0,
    });
    continue;
  }

  const combined = extracted.subject ? `${extracted.subject}\n\n${extracted.text}` : extracted.text;
  const hit = isBookingComConfirmation(undefined, combined)
    ? parseBookingComEmail(firstLineAsSubject(combined), combined)
    : null;

  rows.push({
    file: f,
    matched: hit !== null,
    hotel: hit?.hotelName ?? null,
    checkIn: hit?.checkIn ?? null,
    checkOut: hit?.checkOut ?? null,
    nights: hit?.nights ?? null,
    city: hit?.city ?? null,
    country: hit?.country ?? null,
    postcode: hit?.postcode ?? null,
    address: hit?.address ?? null,
    price: hit?.totalPrice ?? null,
    currency: hit?.currency ?? null,
    ref: hit?.confirmationNumber ?? null,
    room: hit?.roomCategory ?? null,
    textLen: combined.length,
  });
}

const matched = rows.filter((r) => r.matched);
const missed = rows.filter((r) => !r.matched);

console.log(`=== ${rows.length} sample(s) — template hit ${matched.length}, miss ${missed.length} ===\n`);

function pct(n: number): string {
  return `${Math.round((n / Math.max(matched.length, 1)) * 100)}%`;
}
const field = (k: keyof Row): number => matched.filter((r) => r[k] !== null && r[k] !== "").length;

console.log("Field coverage across template hits:");
for (const k of ["hotel", "checkIn", "checkOut", "nights", "address", "postcode", "city", "country", "price", "currency", "ref", "room"] as const) {
  console.log(`  ${k.padEnd(12)} ${String(field(k)).padStart(3)}/${matched.length}  ${pct(field(k))}`);
}

console.log("\n--- MISSES (template did not match) ---");
for (const r of missed) console.log(`  ${r.file}  [text ${r.textLen} chars]  ${r.hotel ?? ""}`);

console.log("\n--- HITS with a gap ---");
for (const r of matched) {
  const gaps = (["checkIn", "checkOut", "city", "country", "price", "ref"] as const).filter(
    (k) => r[k] === null || r[k] === "",
  );
  if (gaps.length > 0) console.log(`  ${r.file}\n      missing: ${gaps.join(", ")}  | hotel=${r.hotel}`);
}

console.log("\n--- FULL TABLE ---");
for (const r of matched) {
  console.log(
    [
      r.hotel ?? "?",
      `${r.checkIn ?? "?"}→${r.checkOut ?? "?"}`,
      `${r.nights ?? "?"}N`,
      [r.postcode, r.city, r.country].filter(Boolean).join(" ") || "?",
      r.price != null ? `${r.price} ${r.currency ?? ""}` : "?",
      r.ref ?? "?",
    ].join(" | "),
  );
}

if (process.env.OUT) {
  // Opt-in only: the rows carry hotel names, addresses and booking references
  // from the owner's private mail, so nothing is written unless asked for.
  fs.writeFileSync(process.env.OUT, JSON.stringify(rows, null, 2));
  console.log(`\nWrote ${rows.length} row(s) to ${process.env.OUT}`);
}
