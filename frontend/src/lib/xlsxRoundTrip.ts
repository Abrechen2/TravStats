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
 *     editable here — IATA codes are the only airport handle, and changing
 *     a code triggers a server-side lookup on import.
 *   - Numeric fields (price, taxes, fees, delayMinutes) round-trip as real
 *     Excel numeric cells so users can sum / filter / format them in Excel.
 *   - Time fields (departureTime, arrivalTime, actualDeparture, actualArrival)
 *     round-trip as real Excel datetime cells with a stable ISO-style format
 *     mask, so Excel's built-in date filters work and the parser can read
 *     either a Date object or an ISO string back.
 *
 * exceljs is loaded dynamically so the parser/writer code only enters
 * the bundle when the user actually clicks Export/Import.
 */

import type { Flight } from "../types";

export interface FlightRow {
  id: string;
  airline: string;
  airlineIata: string;
  airlineIcao: string;
  flightNumber: string;
  callsign: string;
  operatingAirline: string;
  operatingAirlineIata: string;
  operatingAirlineIcao: string;
  isCodeshare: string;
  depIata: string;
  arrIata: string;
  departureTime: string;
  arrivalTime: string;
  depTimeSemantics: string;
  arrTimeSemantics: string;
  actualDeparture: string;
  actualArrival: string;
  delayMinutes: string;
  status: string;
  aircraft: string;
  aircraftRegistration: string;
  aircraftModeS: string;
  seatNumber: string;
  seatClass: string;
  boardingGroup: string;
  gate: string;
  terminal: string;
  bookingReference: string;
  ticketNumber: string;
  baggageAllowance: string;
  frequentFlyerNumber: string;
  bookingClassLetter: string;
  category: string;
  tags: string;
  companions: string;
  coPassengers: string;
  price: string;
  currency: string;
  taxes: string;
  fees: string;
  dataSource: string;
  notes: string;
}

type ColumnType = "text" | "number" | "datetime";

interface ColumnDef {
  key: keyof FlightRow;
  header: string;
  width: number;
  type: ColumnType;
}

/**
 * Order matters — used both for export column layout and import header
 * matching. Keep id first; the import code relies on column A being the
 * stable match key.
 */
const COLUMNS: ReadonlyArray<ColumnDef> = [
  { key: "id", header: "ID", width: 38, type: "text" },
  { key: "airline", header: "Airline", width: 18, type: "text" },
  { key: "airlineIata", header: "Airline IATA", width: 12, type: "text" },
  { key: "airlineIcao", header: "Airline ICAO", width: 12, type: "text" },
  { key: "flightNumber", header: "Flight Number", width: 14, type: "text" },
  { key: "callsign", header: "Callsign", width: 12, type: "text" },
  { key: "operatingAirline", header: "Operated By", width: 18, type: "text" },
  { key: "operatingAirlineIata", header: "Operated By (IATA)", width: 18, type: "text" },
  { key: "operatingAirlineIcao", header: "Operated By (ICAO)", width: 18, type: "text" },
  { key: "isCodeshare", header: "Codeshare", width: 10, type: "text" },
  { key: "depIata", header: "Departure (IATA)", width: 16, type: "text" },
  { key: "arrIata", header: "Arrival (IATA)", width: 16, type: "text" },
  { key: "departureTime", header: "Departure Time (UTC)", width: 22, type: "datetime" },
  { key: "arrivalTime", header: "Arrival Time (UTC)", width: 22, type: "datetime" },
  { key: "depTimeSemantics", header: "Dep Time Semantics", width: 18, type: "text" },
  { key: "arrTimeSemantics", header: "Arr Time Semantics", width: 18, type: "text" },
  { key: "actualDeparture", header: "Actual Departure (UTC)", width: 22, type: "datetime" },
  { key: "actualArrival", header: "Actual Arrival (UTC)", width: 22, type: "datetime" },
  { key: "delayMinutes", header: "Delay (min)", width: 12, type: "number" },
  { key: "status", header: "Status", width: 12, type: "text" },
  { key: "aircraft", header: "Aircraft", width: 14, type: "text" },
  { key: "aircraftRegistration", header: "Registration", width: 14, type: "text" },
  { key: "aircraftModeS", header: "Mode-S", width: 12, type: "text" },
  { key: "seatNumber", header: "Seat", width: 8, type: "text" },
  { key: "seatClass", header: "Class", width: 14, type: "text" },
  { key: "boardingGroup", header: "Boarding Group", width: 14, type: "text" },
  { key: "gate", header: "Gate", width: 8, type: "text" },
  { key: "terminal", header: "Terminal", width: 10, type: "text" },
  { key: "bookingReference", header: "PNR", width: 12, type: "text" },
  { key: "ticketNumber", header: "Ticket Number", width: 18, type: "text" },
  { key: "baggageAllowance", header: "Baggage", width: 14, type: "text" },
  { key: "frequentFlyerNumber", header: "Frequent Flyer", width: 16, type: "text" },
  { key: "bookingClassLetter", header: "Booking Class", width: 14, type: "text" },
  { key: "category", header: "Category", width: 12, type: "text" },
  { key: "tags", header: "Tags", width: 24, type: "text" },
  { key: "companions", header: "Companions", width: 24, type: "text" },
  { key: "coPassengers", header: "Co-Passengers", width: 24, type: "text" },
  { key: "price", header: "Price", width: 10, type: "number" },
  { key: "currency", header: "Currency", width: 10, type: "text" },
  { key: "taxes", header: "Taxes", width: 10, type: "number" },
  { key: "fees", header: "Fees", width: 10, type: "number" },
  { key: "dataSource", header: "Data Source", width: 18, type: "text" },
  { key: "notes", header: "Notes", width: 40, type: "text" },
];

const flightToRow = (f: Flight): FlightRow => ({
  id: f.id,
  airline: f.airline ?? "",
  airlineIata: f.airlineIata ?? "",
  airlineIcao: f.airlineIcao ?? "",
  flightNumber: f.flightNumber ?? "",
  callsign: f.callsign ?? "",
  operatingAirline: f.operatingAirline ?? "",
  operatingAirlineIata: f.operatingAirlineIata ?? "",
  operatingAirlineIcao: f.operatingAirlineIcao ?? "",
  isCodeshare: f.isCodeshare == null ? "" : f.isCodeshare ? "true" : "false",
  depIata: f.depIata ?? f.depIcao ?? "",
  arrIata: f.arrIata ?? f.arrIcao ?? "",
  departureTime: f.departureTime ?? "",
  arrivalTime: f.arrivalTime ?? "",
  depTimeSemantics: f.depTimeSemantics ?? "",
  arrTimeSemantics: f.arrTimeSemantics ?? "",
  actualDeparture: f.actualDeparture ?? "",
  actualArrival: f.actualArrival ?? "",
  delayMinutes: f.delayMinutes != null ? String(f.delayMinutes) : "",
  status: f.status ?? "",
  aircraft: f.aircraft ?? "",
  aircraftRegistration: f.aircraftRegistration ?? "",
  aircraftModeS: f.aircraftModeS ?? "",
  seatNumber: f.seatNumber ?? "",
  seatClass: f.seatClass ?? "",
  boardingGroup: f.boardingGroup ?? "",
  gate: f.gate ?? "",
  terminal: f.terminal ?? "",
  bookingReference: f.bookingReference ?? "",
  ticketNumber: f.ticketNumber ?? "",
  baggageAllowance: f.baggageAllowance ?? "",
  frequentFlyerNumber: f.frequentFlyerNumber ?? "",
  bookingClassLetter: f.bookingClassLetter ?? "",
  category: f.category ?? "",
  tags: (f.tags ?? []).join(", "),
  companions: (f.companions ?? []).join(", "),
  coPassengers: (f.coPassengers ?? []).join(", "),
  price: f.price != null ? String(f.price) : "",
  currency: f.currency ?? "",
  taxes: f.taxes != null ? String(f.taxes) : "",
  fees: f.fees != null ? String(f.fees) : "",
  dataSource: f.dataSource ?? "",
  notes: f.notes ?? "",
});

/** Excel datetime number-format mask. Stable, locale-independent ISO-ish layout. */
const DATETIME_FORMAT = "yyyy-mm-dd hh:mm:ss";

/**
 * Construct the styled exceljs Workbook for a flights export. Pulled out
 * of exportFlightsToXlsx so tests can inspect the workbook directly without
 * paying the Blob ↔ ArrayBuffer trip that jsdom doesn't fully support.
 */
export async function buildFlightsWorkbook(flights: Flight[]): Promise<import("exceljs").Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "TravStats";
  wb.created = new Date();
  const ws = wb.addWorksheet("Flights", {
    // Freeze the header row AND the id column so both stay visible while
    // scrolling a long list horizontally / vertically.
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
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

  // AutoFilter on the entire column range so Excel exposes per-column
  // dropdowns without the user having to enable filtering manually.
  const lastColLetter = ws.getColumn(COLUMNS.length).letter;
  ws.autoFilter = `A1:${lastColLetter}1`;

  // Body rows. Set primitive values per cell type so Excel sees real
  // numbers and dates instead of stringified text.
  for (const f of flights) {
    const rowData = flightToRow(f);
    const row = ws.addRow(rowData);

    COLUMNS.forEach((col, idx) => {
      const cell = row.getCell(idx + 1);
      const raw = rowData[col.key];

      if (col.type === "number") {
        const n = raw === "" ? null : Number(raw);
        cell.value = n != null && !Number.isNaN(n) ? n : null;
      } else if (col.type === "datetime") {
        const d = raw ? new Date(raw) : null;
        if (d && !Number.isNaN(d.getTime())) {
          cell.value = d;
          cell.numFmt = DATETIME_FORMAT;
        } else {
          cell.value = null;
        }
      }
      // Text columns: leave the string ws.addRow already wrote.
    });

    // ID column read-only treatment.
    const idCell = row.getCell(1);
    idCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" },
    };
    idCell.font = { color: { argb: "FF6B7280" }, italic: true };
  }

  return wb;
}

/**
 * Build a formatted .xlsx Blob containing every flight as one row. The id
 * column is greyed out so users can see at a glance that it's a system
 * field; the header row is bold, frozen, and carries an autoFilter so users
 * can filter and sort directly in Excel without prep.
 */
export async function exportFlightsToXlsx(flights: Flight[]): Promise<Blob> {
  const wb = await buildFlightsWorkbook(flights);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * Coerce a raw exceljs cell value into the string shape FlightRow expects.
 * Handles the three native Excel types we emit (string, number, Date) plus
 * the rich-text and formula-result wrappers exceljs occasionally produces.
 */
function cellToString(raw: unknown): string {
  if (raw == null) return "";
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "boolean") return raw ? "true" : "false";
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.result !== "undefined") return cellToString(o.result);
  }
  return String(raw);
}

/**
 * Read an uploaded .xlsx file back into FlightRow records, header-keyed
 * so the caller can match against COLUMNS.key without depending on
 * column position. Empty rows are dropped. We do not try to validate
 * here — the caller decides which rows update vs. create.
 */
export async function parseXlsxToRows(file: File): Promise<FlightRow[]> {
  const buffer = await file.arrayBuffer();
  return parseXlsxBufferToRows(buffer);
}

/**
 * Parse an xlsx ArrayBuffer directly. Lets test code skip the File ↔ Blob
 * arrayBuffer() roundtrip that jsdom doesn't implement.
 */
export async function parseXlsxBufferToRows(buffer: ArrayBuffer): Promise<FlightRow[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? "").trim();
  });

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
      record[key] = cellToString(cell.value);
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
      if (v !== undefined && v !== null && v !== "") {
        if (Array.isArray(v)) return v.join(", ");
        if (v instanceof Date) return v.toISOString();
        return String(v);
      }
    }
    return "";
  };
  return {
    id: pick("ID", "id"),
    airline: pick("Airline", "airline"),
    airlineIata: pick("Airline IATA", "airlineIata", "airline_iata"),
    airlineIcao: pick("Airline ICAO", "airlineIcao", "airline_icao"),
    flightNumber: pick("Flight Number", "flightNumber", "flight_number"),
    callsign: pick("Callsign", "callsign"),
    operatingAirline: pick("Operated By", "operatingAirline", "operating_airline"),
    operatingAirlineIata: pick(
      "Operated By (IATA)",
      "operatingAirlineIata",
      "operating_airline_iata"
    ),
    operatingAirlineIcao: pick(
      "Operated By (ICAO)",
      "operatingAirlineIcao",
      "operating_airline_icao"
    ),
    isCodeshare: pick("Codeshare", "isCodeshare", "is_codeshare"),
    depIata: pick("Departure (IATA)", "Departure Airport", "depIata", "departure_iata"),
    arrIata: pick("Arrival (IATA)", "Arrival Airport", "arrIata", "arrival_iata"),
    departureTime: pick(
      "Departure Time (UTC)",
      "Departure Time",
      "departureTime",
      "departure_time"
    ),
    arrivalTime: pick("Arrival Time (UTC)", "Arrival Time", "arrivalTime", "arrival_time"),
    depTimeSemantics: pick("Dep Time Semantics", "depTimeSemantics", "dep_time_semantics"),
    arrTimeSemantics: pick("Arr Time Semantics", "arrTimeSemantics", "arr_time_semantics"),
    actualDeparture: pick("Actual Departure (UTC)", "actualDeparture", "actual_departure"),
    actualArrival: pick("Actual Arrival (UTC)", "actualArrival", "actual_arrival"),
    delayMinutes: pick("Delay (min)", "delayMinutes", "delay_minutes"),
    status: pick("Status", "status"),
    aircraft: pick("Aircraft", "aircraft"),
    aircraftRegistration: pick("Registration", "aircraftRegistration", "aircraft_registration"),
    aircraftModeS: pick("Mode-S", "aircraftModeS", "aircraft_mode_s"),
    seatNumber: pick("Seat", "seatNumber", "seat_number"),
    seatClass: pick("Class", "seatClass", "seat_class"),
    boardingGroup: pick("Boarding Group", "boardingGroup", "boarding_group"),
    gate: pick("Gate", "gate"),
    terminal: pick("Terminal", "terminal"),
    bookingReference: pick("PNR", "bookingReference", "booking_reference"),
    ticketNumber: pick("Ticket Number", "ticketNumber", "ticket_number"),
    baggageAllowance: pick("Baggage", "baggageAllowance", "baggage_allowance"),
    frequentFlyerNumber: pick("Frequent Flyer", "frequentFlyerNumber", "frequent_flyer_number"),
    bookingClassLetter: pick("Booking Class", "bookingClassLetter", "booking_class_letter"),
    category: pick("Category", "category"),
    tags: pick("Tags", "tags"),
    companions: pick("Companions", "companions"),
    coPassengers: pick("Co-Passengers", "coPassengers", "co_passengers"),
    price: pick("Price", "price"),
    currency: pick("Currency", "currency"),
    taxes: pick("Taxes", "taxes"),
    fees: pick("Fees", "fees"),
    dataSource: pick("Data Source", "dataSource", "data_source"),
    notes: pick("Notes", "notes"),
  };
}
