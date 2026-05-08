import { useState, useCallback } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parseCsv } from "../../lib/csvParser";
import {
  parseXlsxToRows,
  jsonToFlightRow,
  type FlightRow,
} from "../../lib/xlsxRoundTrip";
import { api } from "../../lib/api/client";
import { airportsApi } from "../../lib/api/airports";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import type { FlightInput } from "../../types";

// ---------------------------------------------------------------------------
// Helpers lifted verbatim from DashboardPage.tsx (Task 9 — see Task 10 for
// removal from the dashboard). Keeping the same names so grep/references match.
// ---------------------------------------------------------------------------

/**
 * Pick the right parser by file extension. JSON is treated as an
 * already-shaped array of FlightRow-like records; CSV runs through
 * the RFC-4180 parser; XLSX uses exceljs.
 */
async function parseImportFile(file: File): Promise<FlightRow[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    return parseXlsxToRows(file);
  }
  if (!lower.endsWith(".json") && !lower.endsWith(".csv")) {
    throw new Error("Unsupported file extension");
  }
  const text = await file.text();
  if (lower.endsWith(".json")) {
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map(jsonToFlightRow);
  }
  // .csv (default fallback)
  const records = parseCsv(text);
  return records.map(jsonToFlightRow);
}

/**
 * Build the partial update payload for a row that carries an existing
 * id. Empty cells are skipped so the user can clear individual fields
 * via the in-app edit modal — round-trip Excel only fills, never
 * blanks. Lat/lon are deliberately left out: airports cannot be
 * changed via Excel because we'd need to look up the new coords.
 */
function rowToUpdates(row: FlightRow): Partial<FlightInput> {
  // CSV/XLSX rounds carry no IANA tz column, so default to the user's
  // display timezone — the server will resolve to UTC via fromZonedTime.
  const importTz = useSettingsStore.getState().display?.timezone || "UTC";
  const u: Partial<FlightInput> = {};
  if (row.airline) u.airline = row.airline;
  if (row.airlineIata) u.airlineIata = row.airlineIata;
  if (row.airlineIcao) u.airlineIcao = row.airlineIcao;
  if (row.flightNumber) u.flightNumber = row.flightNumber;
  if (row.callsign) u.callsign = row.callsign;
  if (row.operatingAirline) u.operatingAirline = row.operatingAirline;
  if (row.operatingAirlineIata) u.operatingAirlineIata = row.operatingAirlineIata;
  if (row.operatingAirlineIcao) u.operatingAirlineIcao = row.operatingAirlineIcao;
  if (row.isCodeshare) u.isCodeshare = row.isCodeshare === "true";
  if (row.departureTime) {
    u.departureLocal = row.departureTime;
    u.depTimezone = importTz;
  }
  if (row.arrivalTime) {
    u.arrivalLocal = row.arrivalTime;
    u.arrTimezone = importTz;
  }
  if (row.depTimeSemantics)
    u.depTimeSemantics = row.depTimeSemantics as FlightInput["depTimeSemantics"];
  if (row.arrTimeSemantics)
    u.arrTimeSemantics = row.arrTimeSemantics as FlightInput["arrTimeSemantics"];
  if (row.actualDeparture) {
    u.actualDepartureLocal = row.actualDeparture;
    u.actualDepartureTz = importTz;
  }
  if (row.actualArrival) {
    u.actualArrivalLocal = row.actualArrival;
    u.actualArrivalTz = importTz;
  }
  if (row.status) u.status = row.status as FlightInput["status"];
  if (row.aircraft) u.aircraft = row.aircraft;
  if (row.aircraftRegistration) u.aircraftRegistration = row.aircraftRegistration;
  if (row.aircraftModeS) u.aircraftModeS = row.aircraftModeS;
  if (row.seatNumber) u.seatNumber = row.seatNumber;
  if (row.seatClass) u.seatClass = row.seatClass as FlightInput["seatClass"];
  if (row.boardingGroup) u.boardingGroup = row.boardingGroup;
  if (row.gate) u.gate = row.gate;
  if (row.terminal) u.terminal = row.terminal;
  if (row.bookingReference) u.bookingReference = row.bookingReference;
  if (row.ticketNumber) u.ticketNumber = row.ticketNumber;
  if (row.baggageAllowance) u.baggageAllowance = row.baggageAllowance;
  if (row.frequentFlyerNumber) u.frequentFlyerNumber = row.frequentFlyerNumber;
  if (row.bookingClassLetter) u.bookingClassLetter = row.bookingClassLetter;
  if (row.category) u.category = row.category as FlightInput["category"];
  if (row.tags)
    u.tags = row.tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  if (row.companions)
    u.companions = row.companions
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  if (row.coPassengers)
    u.coPassengers = row.coPassengers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  if (row.price) u.price = Number(row.price);
  if (row.currency) u.currency = row.currency as FlightInput["currency"];
  if (row.taxes) u.taxes = Number(row.taxes);
  if (row.fees) u.fees = Number(row.fees);
  if (row.dataSource) u.dataSource = row.dataSource as FlightInput["dataSource"];
  if (row.notes) u.notes = row.notes;
  return u;
}

/**
 * Build a full FlightInput for a brand-new row (no id). Airports are
 * resolved by IATA via airportsApi — we need lat/lon for the create
 * payload, and Excel only carries the IATA code. If lookup fails the
 * whole row is rejected; the user can retry with a corrected code.
 */
async function rowToCreateInput(row: FlightRow): Promise<FlightInput> {
  if (!row.depIata || !row.arrIata) {
    throw new Error("Departure and arrival IATA required for new flights");
  }
  const [dep, arr] = await Promise.all([
    airportsApi.getByCode(row.depIata),
    airportsApi.getByCode(row.arrIata),
  ]);
  const importTz = useSettingsStore.getState().display?.timezone || "UTC";
  return {
    airline: row.airline || undefined,
    airlineIata: row.airlineIata || undefined,
    airlineIcao: row.airlineIcao || undefined,
    flightNumber: row.flightNumber || undefined,
    callsign: row.callsign || undefined,
    operatingAirline: row.operatingAirline || undefined,
    operatingAirlineIata: row.operatingAirlineIata || undefined,
    operatingAirlineIcao: row.operatingAirlineIcao || undefined,
    isCodeshare: row.isCodeshare ? row.isCodeshare === "true" : undefined,
    departure: { iata: dep.iata, icao: dep.icao, name: dep.name, lat: dep.lat, lon: dep.lon },
    arrival: { iata: arr.iata, icao: arr.icao, name: arr.name, lat: arr.lat, lon: arr.lon },
    departureLocal: row.departureTime || undefined,
    depTimezone: row.departureTime ? importTz : undefined,
    arrivalLocal: row.arrivalTime || undefined,
    arrTimezone: row.arrivalTime ? importTz : undefined,
    depTimeSemantics: (row.depTimeSemantics || undefined) as FlightInput["depTimeSemantics"],
    arrTimeSemantics: (row.arrTimeSemantics || undefined) as FlightInput["arrTimeSemantics"],
    actualDepartureLocal: row.actualDeparture || undefined,
    actualDepartureTz: row.actualDeparture ? importTz : undefined,
    actualArrivalLocal: row.actualArrival || undefined,
    actualArrivalTz: row.actualArrival ? importTz : undefined,
    status: (row.status || "flown") as FlightInput["status"],
    aircraft: row.aircraft || undefined,
    aircraftRegistration: row.aircraftRegistration || undefined,
    aircraftModeS: row.aircraftModeS || undefined,
    seatNumber: row.seatNumber || undefined,
    seatClass: (row.seatClass || undefined) as FlightInput["seatClass"],
    boardingGroup: row.boardingGroup || undefined,
    gate: row.gate || undefined,
    terminal: row.terminal || undefined,
    bookingReference: row.bookingReference || undefined,
    ticketNumber: row.ticketNumber || undefined,
    baggageAllowance: row.baggageAllowance || undefined,
    frequentFlyerNumber: row.frequentFlyerNumber || undefined,
    bookingClassLetter: row.bookingClassLetter || undefined,
    category: (row.category || undefined) as FlightInput["category"],
    tags: row.tags
      ? row.tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    companions: row.companions
      ? row.companions
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    coPassengers: row.coPassengers
      ? row.coPassengers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    price: row.price ? Number(row.price) : undefined,
    currency: (row.currency || undefined) as FlightInput["currency"],
    taxes: row.taxes ? Number(row.taxes) : undefined,
    fees: row.fees ? Number(row.fees) : undefined,
    dataSource: (row.dataSource || undefined) as FlightInput["dataSource"],
    notes: row.notes || undefined,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RoundTripImportTile(): JSX.Element {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<{ updated: number; created: number } | null>(null);

  const handleFile = useCallback(async (file: File): Promise<void> => {
    setError(null);
    setStats(null);
    setBusy(true);
    try {
      const rows = await parseImportFile(file);
      const toUpdate = rows.filter((r) => r.id);
      const toCreate: FlightInput[] = [];

      // Resolve airport data for all new rows up-front; bail on first failure
      for (const r of rows.filter((row) => !row.id)) {
        const payload = await rowToCreateInput(r);
        toCreate.push(payload);
      }

      let updated = 0;
      for (const r of toUpdate) {
        await api.put(`/flights/${r.id}`, rowToUpdates(r));
        updated++;
      }

      // Chunk creations to 20-per-batch
      for (let i = 0; i < toCreate.length; i += 20) {
        await api.post("/flights/batch", toCreate.slice(i, i + 20));
      }

      setStats({ updated, created: toCreate.length });
    } catch (err) {
      logger.error("round_trip_import_failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="import-tile">
      <h3>{t("settings:import.tile.roundTrip.title")}</h3>
      <p>{t("settings:import.tile.roundTrip.description")}</p>
      <label>
        <span>{t("settings:import.tile.roundTrip.uploadLabel")}</span>
        <input
          type="file"
          accept=".csv,.json,.xlsx"
          disabled={busy}
          aria-label={t("settings:import.tile.roundTrip.uploadLabel")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleFile(file);
            }
          }}
        />
      </label>
      {busy && <p className="import-tile__busy">{t("common:loading")}</p>}
      {error && <pre className="import-error">{error}</pre>}
      {stats && (
        <p className="import-tile__stats">
          {t("settings:import.tile.roundTrip.successSummary", {
            updated: stats.updated,
            created: stats.created,
          })}
        </p>
      )}
    </div>
  );
}
