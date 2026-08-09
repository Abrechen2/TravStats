/**
 * RFC-4180 CSV parser. Replaces the old line.split(",") approach in
 * DashboardPage's import flow, which silently corrupted any Notes /
 * Companions / Tags field that contained a comma or quoted value
 * (common when round-tripping our own CSV export, since toCsv quotes
 * cells that include commas or newlines).
 *
 * Behaviour:
 *   - First non-empty row is treated as the header.
 *   - Quoted fields may span newlines; "" inside a quoted field decodes
 *     to a literal ".
 *   - CRLF and LF line endings are both accepted; a trailing newline is
 *     ignored. UTF-8 BOM is stripped.
 *   - The delimiter is comma, semicolon or tab, detected from the header
 *     row (see `detectDelimiter`).
 *   - Output is `Array<Record<header, string>>`. Cells past the header
 *     length are dropped; missing trailing cells default to "".
 */

const BOM = "﻿";

/**
 * Pick the delimiter from the HEADER ROW alone.
 *
 * German Excel writes `;` by default (comma is the decimal mark in that
 * locale) and "Text (tab delimited)" writes `\t`. Parsed as comma, such a
 * file collapses into ONE column: the import wizard offers a single nonsense
 * header, every mapped cell reads back empty, and the importer rejects the
 * whole file — the exact "not a single row could be read" dead end reported
 * against the lodging stays import.
 *
 * Deliberately conservative: a header containing even ONE comma stays on
 * comma. Files that parse correctly today therefore cannot change meaning —
 * only files that are currently unreadable start working. Quoted header
 * cells are skipped so a `"Name, Ort";Land` header still detects `;`.
 */
function detectDelimiter(text: string): string {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') i += 1;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    // Header row only — the first unquoted line terminator ends the scan.
    if (ch === "\n" || ch === "\r") break;
    if (ch === "," || ch === ";" || ch === "\t") counts[ch] += 1;
  }
  if (counts[","] > 0) return ",";
  if (counts[";"] > 0 || counts["\t"] > 0) return counts[";"] >= counts["\t"] ? ";" : "\t";
  return ",";
}

export function parseCsv(content: string): Record<string, string>[] {
  const text = content.startsWith(BOM) ? content.slice(1) : content;
  const rows = tokenize(text, detectDelimiter(text));
  if (rows.length === 0) return [];

  // First non-empty row = header
  let headerIdx = 0;
  while (headerIdx < rows.length && rows[headerIdx].every((c) => c === "")) {
    headerIdx += 1;
  }
  if (headerIdx >= rows.length) return [];
  const headers = rows[headerIdx].map((h) => h.trim());

  const records: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c) => c === "")) continue;
    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = (row[j] ?? "").trim();
    }
    records.push(record);
  }
  return records;
}

/**
 * Lex a CSV document into rows of cells. Implemented as a small state
 * machine so we don't need a regex-based hack for quoted cells with
 * embedded delimiters or newlines.
 */
function tokenize(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && cell === "") {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      pushCell();
      continue;
    }
    if (ch === "\n") {
      pushRow();
      continue;
    }
    if (ch === "\r") {
      // CRLF is a single line terminator — swallow the following \n.
      if (text[i + 1] === "\n") i += 1;
      pushRow();
      continue;
    }
    cell += ch;
  }

  // Flush any trailing cell/row that wasn't terminated by a newline.
  if (cell !== "" || row.length > 0) {
    pushRow();
  }
  return rows;
}
