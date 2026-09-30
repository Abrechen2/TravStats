#!/usr/bin/env node
/**
 * Builds backend/data/rail/station_codes.csv — the short station code
 * (DB "Ril 100" / DS100, e.g. KK for Köln Hbf) per EVA number — and its
 * provenance file station_codes.SOURCES.md. forgejo#132 item 16.
 *
 * Usage (network at script time only; nothing is fetched at runtime):
 *   node backend/scripts/build-rail-station-codes.mjs
 *   node backend/scripts/build-rail-station-codes.mjs --netex /path/netex.xml --wikidata /path/wd.csv
 *
 * Sources, in order of authority:
 *   1. DB InfraGO OpenStation NeTEx (CC0), https://bahnhof.de/daten/netex —
 *      every StopPlace carries `EVA` and `RIL` keys in its own keyList. The
 *      ~300 MB XML is STREAMED and parsed one StopPlace at a time; it is never
 *      written to disk, let alone to the repository.
 *   2. Wikidata (CC0), property P8671 (Deutsche Bahn station code) joined via
 *      P954 (IBNR = EVA), for EVAs OpenStation does not name.
 *
 * The multi-code rule: a key can hold "DN  A" (a code plus an operating-
 * section suffix) — the FIRST whitespace token is the code. A station can
 * carry several codes ("FF" and "FFT" for Frankfurt (Main) Hbf; the second
 * names the deep-level platforms) — the SHORTEST wins, ties alphabetically.
 * The same rule applies to several Wikidata values.
 *
 * Only EVAs that appear as `db_id` in the vendored catalogue
 * (data/rail/stations.csv.gz) are written: a code the app can never show is
 * weight without purpose. An EVA with no code in either source is simply
 * absent — the app answers null for it, it never guesses one.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "..", "data", "rail");
const CATALOGUE = path.join(dataDir, "stations.csv.gz");
const TARGET = path.join(dataDir, "station_codes.csv");
const SOURCES = path.join(dataDir, "station_codes.SOURCES.md");

const NETEX_URL = "https://bahnhof.de/daten/netex";
const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "TravStats-station-codes/1.0 (https://travstats.de; build script, one request per source)";
const SPARQL = `SELECT ?eva ?code WHERE {
  ?station wdt:P954 ?eva ;
           wdt:P8671 ?code .
}`;

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** First whitespace token of every value, deduplicated, shortest first, then A–Z. */
function pickCode(values) {
  const tokens = [
    ...new Set(
      values.map((v) => v.trim().split(/\s+/)[0]).filter((t) => t && /^[A-Z0-9]+$/i.test(t))
    ),
  ];
  tokens.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return tokens[0] ?? null;
}

async function* textChunks(source) {
  if (source) {
    for await (const chunk of fs.createReadStream(source, { encoding: "utf-8" })) yield chunk;
    return;
  }
  const res = await fetch(NETEX_URL, {
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "gzip" },
  });
  if (!res.ok || !res.body) throw new Error(`OpenStation NeTEx: HTTP ${res.status}`);
  // fetch decodes Content-Encoding itself; the body arrives as plain XML.
  const decoder = new TextDecoder("utf-8");
  for await (const chunk of Readable.fromWeb(res.body))
    yield decoder.decode(chunk, { stream: true });
}

const KEY_VALUE = /<KeyValue>\s*<Key>([^<]*)<\/Key>\s*<Value>([^<]*)<\/Value>\s*<\/KeyValue>/g;

/** EVA → code from OpenStation, streaming one StopPlace at a time. */
async function readOpenStation(source) {
  const map = new Map();
  let buffer = "";
  let stopPlaces = 0;
  let multi = 0;
  let timestamp = null;
  for await (const chunk of textChunks(source)) {
    buffer += chunk;
    if (!timestamp) {
      const m = /<PublicationTimestamp>([^<]+)<\/PublicationTimestamp>/.exec(buffer);
      if (m) timestamp = m[1];
    }
    for (;;) {
      const start = buffer.indexOf("<StopPlace ");
      if (start < 0) {
        // Keep a tail in case the opening tag straddles two chunks.
        buffer = buffer.slice(-32);
        break;
      }
      const end = buffer.indexOf("</StopPlace>", start);
      if (end < 0) {
        buffer = buffer.slice(start);
        break;
      }
      const element = buffer.slice(start, end);
      buffer = buffer.slice(end + "</StopPlace>".length);
      stopPlaces += 1;
      // The StopPlace's OWN keyList comes first; quays carry keyLists of their own.
      const own = /<keyList>([\s\S]*?)<\/keyList>/.exec(element);
      if (!own) continue;
      const evas = [];
      const rils = [];
      for (const [, key, value] of own[1].matchAll(KEY_VALUE)) {
        if (key === "EVA") evas.push(value.trim());
        if (key === "RIL") rils.push(value);
      }
      const code = pickCode(rils);
      if (!code) continue;
      if (new Set(rils.map((r) => r.trim().split(/\s+/)[0])).size > 1) multi += 1;
      for (const eva of evas) if (eva && !map.has(eva)) map.set(eva, code);
    }
  }
  return { map, stopPlaces, multi, timestamp };
}

/** EVA → code from Wikidata (one SPARQL request), or from a local `eva,code` CSV. */
async function readWikidata(source) {
  let rows;
  if (source) {
    rows = parse(fs.readFileSync(source, "utf-8"), { columns: true, skip_empty_lines: true }).map(
      (r) => [r.eva ?? r.i, r.code ?? r.c]
    );
  } else {
    const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(SPARQL)}&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
    });
    if (!res.ok) throw new Error(`Wikidata SPARQL: HTTP ${res.status}`);
    const json = await res.json();
    rows = json.results.bindings.map((b) => [b.eva.value, b.code.value]);
  }
  const all = new Map();
  for (const [eva, code] of rows) {
    if (!eva || !code) continue;
    const list = all.get(eva.trim()) ?? [];
    list.push(code);
    all.set(eva.trim(), list);
  }
  const map = new Map();
  for (const [eva, codes] of all) {
    const code = pickCode(codes);
    if (code) map.set(eva, code);
  }
  return map;
}

function readCatalogue() {
  const rows = parse(zlib.gunzipSync(fs.readFileSync(CATALOGUE)).toString("utf-8"), {
    columns: true,
    skip_empty_lines: true,
  });
  const evas = new Set(rows.map((r) => r.db_id?.trim()).filter(Boolean));
  const germanEvas = new Set(
    rows.filter((r) => r.country === "DE" && r.db_id?.trim()).map((r) => r.db_id.trim())
  );
  return { evas, germanEvas };
}

async function main() {
  const retrieved = new Date().toISOString().slice(0, 10);
  const { evas, germanEvas } = readCatalogue();
  console.log(`catalogue: ${evas.size} distinct db_id (${germanEvas.size} German)`);
  const os = await readOpenStation(arg("--netex"));
  console.log(`openstation: ${os.stopPlaces} stop places, ${os.map.size} EVAs with a code`);
  // One request to a second host, after the first finished — no parallel load.
  const wd = await readWikidata(arg("--wikidata"));
  console.log(`wikidata: ${wd.size} EVAs with a code`);

  const out = [];
  let disagree = 0;
  for (const eva of [...evas].sort()) {
    const fromOs = os.map.get(eva);
    const fromWd = wd.get(eva);
    if (fromOs) {
      if (fromWd && fromWd !== fromOs) disagree += 1;
      out.push([eva, fromOs, "openstation"]);
    } else if (fromWd) {
      out.push([eva, fromWd, "wikidata"]);
    }
  }
  const csv = `eva,code,source\n${out.map((r) => r.join(",")).join("\n")}\n`;
  fs.writeFileSync(TARGET, csv, "utf-8");

  const covered = new Set(out.map((r) => r[0]));
  const deCovered = [...germanEvas].filter((e) => covered.has(e)).length;
  const bySource = (s) => out.filter((r) => r[2] === s).length;
  const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : "0.0");
  const stats = {
    retrieved,
    netexTimestamp: os.timestamp,
    rows: out.length,
    openstation: bySource("openstation"),
    wikidata: bySource("wikidata"),
    catalogueEvas: evas.size,
    germanEvas: germanEvas.size,
    deCovered,
    dePct: pct(deCovered, germanEvas.size),
    allPct: pct(out.length, evas.size),
    multi: os.multi,
    disagree,
    bytes: Buffer.byteLength(csv),
  };
  fs.writeFileSync(SOURCES, sourcesMarkdown(stats), "utf-8");
  console.log(stats);
}

function sourcesMarkdown(s) {
  return `# station_codes.csv — sources

Generated by \`backend/scripts/build-rail-station-codes.mjs\` on ${s.retrieved}.
Re-run the script to refresh; it is the complete description of the transformation.

Columns: \`eva\` (DB EVA number, the catalogue's \`db_id\`), \`code\` (DB station
code, "Ril 100" / DS100, e.g. \`KK\` for Köln Hbf), \`source\` (\`openstation\` or
\`wikidata\`).

## 1. DB InfraGO OpenStation NeTEx — primary

- URL: ${NETEX_URL} (redirects to the Mobilithek publication
  https://mobilithek.info/offers/879076212433727488)
- Retrieved: ${s.retrieved}; dataset \`PublicationTimestamp\` ${s.netexTimestamp ?? "unknown"}
- Documentation: https://github.com/dbinfrago/openstation-docs
- Licence, quoted from the documentation's README: "Data in the API as well as the
  API documentation is released to the public domain (under the
  [CC0 “license”](https://creativecommons.org/publicdomain/zero/1.0/))."
- Used: the \`EVA\` and \`RIL\` keys in each \`StopPlace\`'s own \`keyList\`. The
  ~300 MB XML is streamed and never stored.

## 2. Wikidata — fills gaps

- Endpoint: ${WIKIDATA_ENDPOINT}
- Retrieved: ${s.retrieved}
- Licence, quoted from https://www.wikidata.org/wiki/Wikidata:Licensing: "All
  structured data (i.e. the main, Property, Lexeme, and EntitySchema namespaces) is
  released into the public domain under Creative Commons Zero."
- Properties: P954 (IBNR — the EVA number) and P8671 (Deutsche Bahn station code).
- Query:

\`\`\`sparql
${SPARQL}
\`\`\`

## Rules

- **Join:** on the vendored catalogue's \`db_id\` (\`data/rail/stations.csv.gz\`).
  Only EVAs present there are written.
- **Precedence:** OpenStation first; Wikidata only for an EVA OpenStation does not
  name. Where both name one, they disagreed on ${s.disagree} EVAs (OpenStation kept).
- **Multi-code rule:** a value's FIRST whitespace token is the code (\`DN  A\` →
  \`DN\`); of several codes for one station the SHORTEST wins, ties alphabetically
  (\`FF\` / \`FFT\` → \`FF\`). ${s.multi} OpenStation stop places carried more than one.
- **No code → no row.** The app then reports \`shortCode: null\`; it never derives one.

## Measured coverage (${s.retrieved})

| | |
|---|---|
| rows written | ${s.rows} (${s.openstation} OpenStation, ${s.wikidata} Wikidata) |
| distinct \`db_id\` in the catalogue | ${s.catalogueEvas} — ${s.allPct} % covered |
| German (\`country = DE\`) \`db_id\` | ${s.germanEvas} — ${s.deCovered} covered, ${s.dePct} % |
| file size | ${s.bytes} bytes |
`;
}

await main();
