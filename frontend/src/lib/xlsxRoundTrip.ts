/**
 * Excel round-trip helpers — export flights to a human-editable .xlsx and
 * parse one back into row records. The file format is intentionally a thin,
 * tabular projection of the Flight model, NOT a full database dump:
 *
 *   - Column A is the flight id (immutable, greyed out — used to match
 *     re-imported rows to existing DB rows). Editing the id breaks the
 *     match; rows whose id no longer matches will be created as new
 *     flights instead of updated.
 *   - Columns B+ are user-editable fields. Airport coordinates are NOT
 *     editable here — IATA codes are read-only and changes to them are
 *     ignored, since editing in Excel cannot trigger airport lookup.
 *   - Times round-trip through Excel as ISO strings inside text cells
 *     (not Excel's native date type). Letting Excel auto-detect dates
 *     loses the timezone offset and reformats to local-time, which would
 *     break the canonical-UTC storage.
 *
 * exceljs is loaded dynamically so the parser/writer code only enters
 * the bundle when the user actually clicks Export/Import.
 */

import type { Flight } from "../types";

export interface FlightRow {
  id: string;
  airline: string;
  flightNumber: string;
  operatingAirline: string;
  depIata: string;
  arrIata: string;
  departureTime: string;
  arrivalTime: string;
  status: string;
  aircraft: string;
  seatNumber: string;
  seatClass: string;
  gate: string;
  terminal: string;
  bookingReference: string;
  ticketNumber: string;
  category: string;
  tags: string;
  companions: string;
  price: string;
  currency: string;
  taxes: string;
  fees: string;
  notes: string;
}

/**
 * Order matters — used both for export column layout and import header
 * matching. Keep id first; the import code relies on column A being the
 * stable match key.
 */
const COLUMNS: ReadonlyArray<{ key: keyof FlightRow; header: string; width: number }> = [
  { key: "id", header: "ID", width: 38 },
  { key: "airline", header: "Airline", width: 18 },
  { key: "flightNumber", header: "Flight Number", width: 14 },
  { key: "operatingAirline", header: "Operated By", width: 18 },
  { key: "depIata", header: "Departure (IATA)", width: 16 },
  { key: "arrIata", header: "Arrival (IATA)", width: 16 },
  { key: "departureTime", header: "Departure Time (UTC)", width: 22 },
  { key: "arrivalTime", header: "Arrival Time (UTC)", width: 22 },
  { key: "status", header: "Status", width: 12 },
  { key: "aircraft", header: "Aircraft", width: 14 },
  { key: "seatNumber", header: "Seat", width: 8 },
  { key: "seatClass", header: "Class", width: 14 },
  { key: "gate", header: "Gate", width: 8 },
  { key: "terminal", header: "Terminal", width: 10 },
  { key: "bookingReference", header: "PNR", width: 12 },
  { key: "ticketNumber", header: "Ticket Number", width: 18 },
  { key: "category", header: "Category", width: 12 },
  { key: "tags", header: "Tags", width: 24 },
  { key: "companions", header: "Companions", width: 24 },
  { key: "price", header: "Price", width: 10 },
  { key: "currency", header: "Currency", width: 10 },
  { key: "taxes", header: "Taxes", width: 10 },
  { key: "fees", header: "Fees", width: 10 },
  { key: "notes", header: "Notes", width: 40 },
];

const flightToRow = (f: Flight): FlightRow => ({
  id: f.id,
  airline: f.airline ?? "",
  flightNumber: f.flightNumber ?? "",
  operatingAirline: f.operatingAirline ?? "",
  depIata: f.depIata ?? f.depIcao ?? "",
  arrIata: f.arrIata ?? f.arrIcao ?? "",
  departureTime: f.departureTime ?? "",
  arrivalTime: f.arrivalTime ?? "",
  status: f.status ?? "",
  aircraft: f.aircraft ?? "",
  seatNumber: f.seatNumber ?? "",
  seatClass: f.seatClass ?? "",
  gate: f.gate ?? "",
  terminal: f.terminal ?? "",
  bookingReference: f.bookingReference ?? "",
  ticketNumber: f.ticketNumber ?? "",
  category: f.category ?? "",
  tags: (f.tags ?? []).join(", "),
  companions: (f.companions ?? []).join(", "),
  price: f.price != null ? String(f.price) : "",
  currency: f.currency ?? "",
  taxes: f.taxes != null ? String(f.taxes) : "",
  fees: f.fees != null ? String(f.fees) : "",
  notes: f.notes ?? "",
});

/**
 * Build a formatted .xlsx Blob containing every flight as one row. The id
 * column is greyed out so users can see at a glance that it's a system
 * field; the header row is bold and frozen so it stays visible while
 * scrolling long lists.
 */
export async function exportFlightsToXlsx(flights: Flight[]): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "TravStats";
  wb.created = new Date();
  const ws = wb.addWorksheet("Flights", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  // Header styling: bold white text on dark blue, centered.
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F2937" },
  };
  headerRow.height = 22;

  // Body rows + style the id column as read-only/grey on each data row.
  for (const f of flights) {
    const row = ws.addRow(flightToRow(f));
    const idCell = row.getCell(1);
    idCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" },
    };
    idCell.font = { color: { argb: "FF6B7280" }, italic: true };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * Read an uploaded .xlsx file back into FlightRow records, header-keyed
 * so the caller can match against COLUMNS.key without depending on
 * column position. Empty rows are dropped. We do not try to validate
 * here — the caller decides which rows update vs. create.
 */
export async function parseXlsxToRows(file: File): Promise<FlightRow[]> {
  const ExcelJS = (await import("exceljs")).default;
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? "").trim();
  });

  // Map "Airline" → "airline" by matching against COLUMNS.header.
  const headerToKey = new Map<string, keyof FlightRow>();
  for (const col of COLUMNS) {
    headerToKey.set(col.header.toLowerCase(), col.key);
  }

  const rows: FlightRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Partial<FlightRow> = {};
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const header = (headers[col - 1] ?? "").toLowerCase();
      const key = headerToKey.get(header);
      if (!key) return;
      const raw = cell.value;
      record[key] =
        raw == null
          ? ""
          : typeof raw === "object" && "text" in (raw as unknown as Record<string, unknown>)
            ? String((raw as unknown as { text: string }).text)
            : String(raw);
    });
    if (Object.values(record).every((v) => !v)) return; // skip blank
    rows.push(buildEmptyRow(record));
  });
  return rows;
}

const buildEmptyRow = (partial: Partial<FlightRow>): FlightRow => {
  const empty = COLUMNS.reduce(
    (acc, c) => ({ ...acc, [c.key]: "" }),
    {} as Record<keyof FlightRow, string>
  );
  return { ...empty, ...partial } as FlightRow;
};

export const FLIGHT_ROW_COLUMNS = COLUMNS;

/**
 * Convert a header-keyed record (from parseCsv or a JSON import) into a
 * FlightRow. Tolerates both the canonical header text we export ("Flight
 * Number", "Departure (IATA)", "Departure Time (UTC)") and the camelCase
 * keys we emit when serializing FlightInput to JSON, so a JSON dump
 * produced outside the export flow can still round-trip in.
 */
export function jsonToFlightRow(item: unknown): FlightRow {
  const r = (item ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = r[k];
      if (v !== undefined && v !== null && v !== "") return String(v);
    }
    return "";
  };
  return {
    id: pick("ID", "id"),
    airline: pick("Airline", "airline"),
    flightNumber: pick("Flight Number", "flightNumber", "flight_number"),
    operatingAirline: pick("Operated By", "operatingAirline", "operating_airline"),
    depIata: pick("Departure (IATA)", "Departure Airport", "depIata", "departure_iata"),
    arrIata: pick("Arrival (IATA)", "Arrival Airport", "arrIata", "arrival_iata"),
    departureTime: pick(
      "Departure Time (UTC)",
      "Departure Time",
      "departureTime",
      "departure_time"
    ),
    arrivalTime: pick("Arrival Time (UTC)", "Arrival Time", "arrivalTime", "arrival_time"),
    status: pick("Status", "status"),
    aircraft: pick("Aircraft", "aircraft"),
    seatNumber: pick("Seat", "seatNumber", "seat_number"),
    seatClass: pick("Class", "seatClass", "seat_class"),
    gate: pick("Gate", "gate"),
    terminal: pick("Terminal", "terminal"),
    bookingReference: pick("PNR", "bookingReference", "booking_reference"),
    ticketNumber: pick("Ticket Number", "ticketNumber", "ticket_number"),
    category: pick("Category", "category"),
    tags: pick("Tags", "tags"),
    companions: pick("Companions", "companions"),
    price: pick("Price", "price"),
    currency: pick("Currency", "currency"),
    taxes: pick("Taxes", "taxes"),
    fees: pick("Fees", "fees"),
    notes: pick("Notes", "notes"),
  };
}
