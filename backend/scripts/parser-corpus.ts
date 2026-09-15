/**
 * Run the document parsers over a local corpus and write what they found.
 *
 * The corpus is the owner's own mail set under `test-samples/` — gitignored,
 * never committed, never quoted into an issue. This script IS committed: it
 * carries no data, only the way to measure. The `parserTemplates` beta gate
 * asks for exactly this measurement ("tested against the sample set") and had
 * no tool for it until 2026-09-05.
 *
 * Same pipeline as `POST /parse-email-file`: `extractEmailFromFile` →
 * `parseDocument` with the mail's own send date as the reference date. A PDF
 * goes through `extractTextFromPdf` as a `document`, like `/parse-pdf`.
 *
 * Which parser answers is decided the way it is in production — the text
 * fallback chain (`ollama`, then `regex`) against whatever `OLLAMA_URL` (or
 * the admin's parser settings) reaches. `--regex-only` points the chain at a
 * closed port so the regex/template path is measured on its own.
 *
 * Usage (from backend/):
 *   DATABASE_URL=… npx tsx scripts/parser-corpus.ts --dir ../test-samples/Flug-emails --domain flight --tag regex --regex-only
 *   DATABASE_URL=… OLLAMA_URL=http://host:11434 npx tsx scripts/parser-corpus.ts --dir "../test-samples/Hotel Buchungen" --domain lodging --tag ollama --limit 20
 *
 * If `<dir>/expectations.json` exists, each entry is checked and the process
 * exits 1 on any miss — that file is the ratchet, and it is gitignored with
 * the mails it describes.
 */

import fs from "fs";
import path from "path";

interface Args {
  dir: string;
  domain: "flight" | "lodging" | "cruise" | "auto";
  tag: string;
  limit: number;
  regexOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const domain = (get("--domain") ?? "flight") as Args["domain"];
  if (!["flight", "lodging", "cruise", "auto"].includes(domain)) {
    throw new Error(`--domain must be flight|lodging|cruise|auto, got ${domain}`);
  }
  return {
    dir: path.resolve(get("--dir") ?? "../test-samples/Flug-emails"),
    domain,
    tag: get("--tag") ?? "run",
    limit: Number(get("--limit") ?? "0") || 0,
    regexOnly: argv.includes("--regex-only"),
  };
}

const args = parseArgs(process.argv.slice(2));

// Must happen BEFORE the parser modules load: the availability check reads
// the URL at call time, but the admin settings row wins over the env, so this
// only measures the regex path on a dev DB whose admin has no Ollama set.
if (args.regexOnly) {
  process.env.OLLAMA_URL = "http://127.0.0.1:9";
}

interface FlightRow {
  flightNumber: string | null;
  from: string | null;
  to: string | null;
  departure: string | null;
  pnr: string | null;
  airline: string | null;
  missing: string[];
}

interface LodgingRow {
  name: string | null;
  city: string | null;
  checkIn: string | null;
  checkOut: string | null;
  reference: string | null;
}

interface FileResult {
  file: string;
  kind: "email" | "pdf";
  sentAt: string | null;
  domain: string;
  domainSource: string;
  parserUsed: string;
  fallbackReason: string | null;
  candidateCount: number;
  flights?: FlightRow[];
  lodgings?: LodgingRow[];
  /** What a reader should look at. Empty means nothing stood out. */
  flags: string[];
  ms: number;
  error?: string;
}

type Expectation = {
  candidates?: number;
  flights?: Array<{ flightNumber?: string; from?: string; to?: string; date?: string }>;
  lodgings?: Array<{ name?: string; checkIn?: string; checkOut?: string }>;
};

function readExpectations(dir: string): Record<string, Expectation> {
  const file = path.join(dir, "expectations.json");
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Expectation>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function flightRows(flights: unknown[]): FlightRow[] {
  return flights.filter(isRecord).map((f) => ({
    flightNumber: str(f.flightNumber),
    from: str(f.departureCode),
    to: str(f.arrivalCode),
    departure: str(f.departureTime),
    pnr: str(f.pnr) ?? str(f.bookingReference),
    airline: str(f.airline),
    missing: Array.isArray(f.missing)
      ? f.missing.filter((m): m is string => typeof m === "string")
      : [],
  }));
}

function lodgingRows(candidates: unknown[]): LodgingRow[] {
  return candidates.filter(isRecord).map((c) => {
    const lodging = isRecord(c.lodging) ? c.lodging : {};
    const stay = isRecord(c.stay) ? c.stay : {};
    return {
      name: str(lodging.name) ?? str(c.lodgingName),
      city: str(lodging.city),
      checkIn: str(stay.checkIn),
      checkOut: str(stay.checkOut),
      reference: str(stay.bookingReference) ?? str(lodging.externalRef),
    };
  });
}

function flagFlights(rows: FlightRow[]): string[] {
  const flags: string[] = [];
  for (const r of rows) {
    const hasRoute = r.from !== null && r.to !== null;
    if (!r.flightNumber && !hasRoute) flags.push("candidate without flight number or route");
    else if (r.flightNumber && !hasRoute && !r.departure)
      flags.push(`flight number only (${r.flightNumber}) — phantom?`);
    if (r.flightNumber && !/^[A-Z0-9]{2}\d{1,4}$/.test(r.flightNumber))
      flags.push(`odd flight number ${r.flightNumber}`);
  }
  return flags;
}

function flagLodgings(rows: LodgingRow[]): string[] {
  return rows.flatMap((r) =>
    !r.name && !r.checkIn ? ["empty candidate (no name, no check-in)"] : []
  );
}

function checkExpectation(result: FileResult, expected: Expectation | undefined): string[] {
  if (!expected) return [];
  const misses: string[] = [];
  if (expected.candidates !== undefined && result.candidateCount !== expected.candidates) {
    misses.push(`expected ${expected.candidates} candidates, got ${result.candidateCount}`);
  }
  for (const e of expected.flights ?? []) {
    const hit = (result.flights ?? []).some(
      (f) =>
        (e.flightNumber === undefined || f.flightNumber === e.flightNumber) &&
        (e.from === undefined || f.from === e.from) &&
        (e.to === undefined || f.to === e.to) &&
        (e.date === undefined || (f.departure ?? "").startsWith(e.date))
    );
    if (!hit) misses.push(`expected flight ${JSON.stringify(e)} not found`);
  }
  for (const e of expected.lodgings ?? []) {
    const hit = (result.lodgings ?? []).some(
      (l) =>
        (e.name === undefined || l.name === e.name) &&
        (e.checkIn === undefined || l.checkIn === e.checkIn) &&
        (e.checkOut === undefined || l.checkOut === e.checkOut)
    );
    if (!hit) misses.push(`expected stay ${JSON.stringify(e)} not found`);
  }
  return misses;
}

async function main(): Promise<void> {
  // Loaded after the env is settled (see --regex-only above).
  const { extractEmailFromFile } = await import("../src/services/emailExtractor");
  const { extractTextFromPdf } = await import("../src/services/pdfParser");
  const { parseDocument } = await import("../src/services/parsing/parseDocument");
  // The server does this at boot; without it the template registry is empty,
  // the template parser reports itself unavailable and every mail falls to the
  // generic regex — which is exactly what this script measured first, and
  // wrongly. `process.exit` below is what ends the registry's sync timer.
  const { templateRegistry } = await import("../src/services/parsers/templates/registry");
  await templateRegistry.initialize();
  // Also a boot-time step: the airline catalogue that decides whether a
  // flight-number prefix names an airline. Without it the 147-entry curated
  // fallback answers, and the measurement is of a smaller instance than any
  // real one.
  const { preloadAirlineCatalog } = await import("../src/services/airlineCatalogCache");
  await preloadAirlineCatalog();

  const files = fs
    .readdirSync(args.dir)
    .filter((f) => /\.(msg|eml|txt|pdf)$/i.test(f))
    .sort();
  const selected = args.limit > 0 ? files.slice(0, args.limit) : files;
  const expectations = readExpectations(args.dir);

  const results: FileResult[] = [];
  const failures: Array<{ file: string; misses: string[] }> = [];

  for (const file of selected) {
    const full = path.join(args.dir, file);
    const started = Date.now();
    const isPdf = /\.pdf$/i.test(file);
    try {
      const buffer = fs.readFileSync(full);
      let text: string;
      let subject: string | undefined;
      let html: string | undefined;
      let sentAt: Date | undefined;
      if (isPdf) {
        text = await extractTextFromPdf(buffer);
      } else {
        const extracted = extractEmailFromFile(buffer, file);
        text = extracted.text;
        subject = extracted.subject;
        html = extracted.html;
        sentAt = extracted.sentAt ?? undefined;
      }

      const outcome = await parseDocument({
        text,
        subject,
        html,
        domain: args.domain,
        source: isPdf ? "document" : "email",
        ...(sentAt ? { referenceDate: sentAt } : {}),
      });

      const body = outcome.body as Record<string, unknown>;
      const result: FileResult = {
        file,
        kind: isPdf ? "pdf" : "email",
        sentAt: sentAt ? sentAt.toISOString().slice(0, 10) : null,
        domain: outcome.domain,
        domainSource: outcome.domainSource,
        parserUsed: String(body.parserUsed ?? "?"),
        fallbackReason: str(body.fallbackReason),
        candidateCount: 0,
        flags: [],
        ms: Date.now() - started,
      };
      if (outcome.domain === "flight" && Array.isArray(body.flights)) {
        result.flights = flightRows(body.flights);
        result.candidateCount = result.flights.length;
        result.flags = flagFlights(result.flights);
      } else if (outcome.domain === "lodging" && Array.isArray(body.candidates)) {
        result.lodgings = lodgingRows(body.candidates);
        result.candidateCount = result.lodgings.length;
        result.flags = flagLodgings(result.lodgings);
      } else if (outcome.domain === "cruise" && Array.isArray(body.cruises)) {
        result.candidateCount = body.cruises.length;
      }
      const misses = checkExpectation(result, expectations[file]);
      if (misses.length > 0) failures.push({ file, misses });
      results.push(result);

      const summary =
        result.flights
          ?.map(
            (f) => `${f.flightNumber ?? "?"} ${f.from ?? "?"}-${f.to ?? "?"} ${f.departure ?? "?"}`
          )
          .join(" | ") ??
        result.lodgings
          ?.map((l) => `${l.name ?? "?"} ${l.checkIn ?? "?"}→${l.checkOut ?? "?"}`)
          .join(" | ") ??
        "";
      const mark = misses.length > 0 ? "✗" : result.flags.length > 0 ? "!" : " ";
      process.stdout.write(
        `${mark} ${result.parserUsed.padEnd(6)} ${String(result.candidateCount).padStart(2)}  ${file.slice(0, 60).padEnd(60)}  ${summary.slice(0, 90)}\n`
      );
      for (const f of result.flags) process.stdout.write(`      · ${f}\n`);
      for (const m of misses) process.stdout.write(`      ✗ ${m}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        file,
        kind: isPdf ? "pdf" : "email",
        sentAt: null,
        domain: args.domain,
        domainSource: "requested",
        parserUsed: "error",
        fallbackReason: null,
        candidateCount: 0,
        flags: [],
        ms: Date.now() - started,
        error: message,
      });
      process.stdout.write(
        `E ${"error".padEnd(6)}  0  ${file.slice(0, 60).padEnd(60)}  ${message.slice(0, 90)}\n`
      );
    }
  }

  const byParser = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.parserUsed] = (acc[r.parserUsed] ?? 0) + 1;
    return acc;
  }, {});
  const zero = results.filter((r) => r.candidateCount === 0 && !r.error).length;
  const flagged = results.filter((r) => r.flags.length > 0).length;
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  const report = {
    ranAt: new Date().toISOString(),
    dir: args.dir,
    domain: args.domain,
    tag: args.tag,
    regexOnly: args.regexOnly,
    files: results.length,
    byParser,
    zeroCandidates: zero,
    flagged,
    expectationFailures: failures,
    totalMs,
    results,
  };

  const resultsDir = path.resolve(args.dir, "..", "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(resultsDir, `corpus-${args.domain}-${args.tag}-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  process.stdout.write(
    `\n${results.length} files · parsers ${JSON.stringify(byParser)} · ${zero} with 0 candidates · ${flagged} flagged · ${Math.round(totalMs / 1000)} s\n` +
      (Object.keys(expectations).length > 0
        ? `expectations: ${Object.keys(expectations).length} checked, ${failures.length} failed\n`
        : "no expectations.json in this directory — measurement only\n") +
      `→ ${out}\n`
  );
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`corpus run failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(2);
});
