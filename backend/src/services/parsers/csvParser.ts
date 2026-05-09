/**
 * RFC-4180 CSV parser. Backend port of frontend/src/lib/csvParser.ts so
 * the /api/v1/import/parse endpoint can run the same lexer that the
 * browser-side import flow uses, without a runtime polyfill.
 *
 * Behaviour:
 *   - First non-empty row is treated as the header.
 *   - Quoted fields may span newlines; "" inside a quoted field decodes
 *     to a literal ".
 *   - CRLF and LF line endings are both accepted; a trailing newline is
 *     ignored. UTF-8 BOM is stripped.
 *   - Output is `Array<Record<header, string>>`. Cells past the header
 *     length are dropped; missing trailing cells default to "".
 */

const BOM = "﻿";

export function parseCsv(content: string): Record<string, string>[] {
  const text = content.startsWith(BOM) ? content.slice(1) : content;
  const rows = tokenize(text);
  if (rows.length === 0) return [];

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

function tokenize(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = (): void => {
    row.push(cell);
    cell = "";
  };
  const pushRow = (): void => {
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
    if (ch === ",") {
      pushCell();
      continue;
    }
    if (ch === "\n") {
      pushRow();
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      pushRow();
      continue;
    }
    cell += ch;
  }

  if (cell !== "" || row.length > 0) {
    pushRow();
  }
  return rows;
}
