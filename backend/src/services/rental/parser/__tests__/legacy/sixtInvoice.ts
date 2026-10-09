// PARITY REFERENCE ONLY (plan 2026-10-09 P4b): the compiled-in reader this provider's
// v2 template file replaced. Production reads the template; tests compare the two.

import { cleanLines, parseAmount, wallClock } from "../../textLines";
import type { ParsedRentalInvoice } from "../../types";

/**
 * Sixt's final invoice — the `RENTAL_INV` PDF a Sixt invoice mail carries
 * (spec 2026-10-01-rental-domain-design §4.5). Written from the real invoices
 * the owner added to `test-samples/Mietwagen/` on 2026-10-01; one layout, its
 * labels printed in the issuing station's language (French, Dutch, …), so the
 * reader keys on the shapes, with each label in the languages measured:
 *
 * - "Res. no. :" / "Res. nr.:" — the booking number the confirmation carried:
 *   the match key into an existing rental.
 * - "CL No. :" / "Contractnr.:" — the rental agreement number.
 * - two "dd.mm.yyyy HH:MM" readings — the actual pickup and return.
 * - one vehicle row per car: return date, km out, km in, km driven, plate,
 *   model. A swap prints two rows; their km add up.
 * - the gross total — what was charged.
 *
 * Abstention throughout: a row whose km do not add up (in − out ≠ driven) is
 * not read; a model the row does not clearly name stays null. The older
 * `EBI…` invoice layout (2024) is NOT read here — one sample, different shape.
 */

const MARKER = /\bRENTAL_INV\b/;
const RESERVATION = /\bRes\.\s*(?:no|nr)\.?\s*:\s*(\d{8,12})\b/i;
const AGREEMENT = /\b(?:CL No\.|Contractnr\.)\s*:\s*(\d{8,12})\b/i;
const INVOICE_IN_SUBJECT = /(?:Rechnung|invoice|Factuur|Facture)\s+(\d{12,20})\b/i;
const MOMENT = /(\d{2})\.(\d{2})\.(\d{4})\s*\/?\s*(\d{2}):(\d{2})/;
const GROSS =
  /(?:Montant total brut|Totaal brutobedrag|Gesamtbetrag brutto|Bruttobetrag gesamt|Total gross amount)\s+([\d.]+,\d{2})\s*€/i;
/** date, km out, km in, km driven, then plate + model up to the CO2 figure and list price. */
const VEHICLE_ROW =
  /(\d{2})\.(\d{2})\.(\d{4})\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s+\d+\s+[\d.]+,\d{2}\s*€/;

/**
 * Makes whose name opens the model in the vehicle row. The plate before it has
 * no fixed shape across countries ("AB-12-C" beside "X -YZ 123A"), so the model
 * is found by its make rather than by cutting a plate of unknown length.
 */
const MAKES = [
  "Alfa Romeo", "Audi", "BMW", "BYD", "Citroen", "Citroën", "Cupra", "Dacia", "DS", "Fiat",
  "Ford", "Hyundai", "Jaguar", "Jeep", "Kia", "Land Rover", "Lynk", "Mazda", "Mercedes",
  "Mercedes-Benz", "MG", "MINI", "Mitsubishi", "Nissan", "Opel", "Peugeot", "Polestar",
  "Porsche", "Range Rover", "Renault", "Seat", "Skoda", "Škoda", "Smart", "Suzuki", "Tesla",
  "Toyota", "Volkswagen", "Volvo", "VW",
]; // prettier-ignore

export function isSixtInvoice(text: string): boolean {
  return MARKER.test(text) && RESERVATION.test(text);
}

function modelOf(platePlusModel: string): string | null {
  const lower = platePlusModel.toLowerCase();
  let best: number | null = null;
  for (const make of MAKES) {
    const at = lower.search(
      new RegExp(`(^|\\s)${make.toLowerCase().replace(/[-.]/g, "\\$&")}(\\s|$)`)
    );
    if (at >= 0 && (best === null || at < best)) best = at;
  }
  return best === null ? null : platePlusModel.slice(best).trim();
}

interface VehicleRow {
  out: number;
  in: number;
  driven: number;
  model: string | null;
}

function vehicleRows(lines: string[]): VehicleRow[] {
  const rows: VehicleRow[] = [];
  for (const line of lines) {
    const m = VEHICLE_ROW.exec(line);
    if (!m) continue;
    const [out, inn, driven] = [Number(m[4]), Number(m[5]), Number(m[6])];
    // The row's own arithmetic is the proof it was read right.
    if (inn - out !== driven) continue;
    rows.push({ out, in: inn, driven, model: modelOf(m[7]) });
  }
  return rows;
}

function moments(lines: string[]): string[] {
  return lines
    .map((l) => MOMENT.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => wallClock(Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4]), Number(m[5])))
    .filter((v): v is string => v !== null);
}

/** Reads a Sixt invoice; null when the text is not one. `subject` may carry the invoice number. */
export function parseSixtInvoice(
  text: string,
  subject?: string | null
): ParsedRentalInvoice | null {
  if (!isSixtInvoice(text)) return null;
  const lines = cleanLines(text);
  const rows = vehicleRows(lines);
  const times = moments(lines.slice(lines.findIndex((l) => /Station\s*:/.test(l))));
  const gross = GROSS.exec(text);
  const finalAmount = gross ? parseAmount(gross[1]) : null;
  const models = [...new Set(rows.map((r) => r.model).filter((m): m is string => m !== null))];
  return {
    kind: "invoice",
    source: "sixt-invoice",
    provider: "Sixt",
    confirmationNumber: RESERVATION.exec(text)?.[1] ?? null,
    agreementNumber: AGREEMENT.exec(text)?.[1] ?? null,
    invoiceNumber: INVOICE_IN_SUBJECT.exec(subject ?? "")?.[1] ?? null,
    // One car: its odometer pair. A swap has no single pair, so none is claimed.
    odometerOutKm: rows.length === 1 ? rows[0].out : null,
    odometerInKm: rows.length === 1 ? rows[0].in : null,
    distanceKm: rows.length > 0 ? rows.reduce((sum, r) => sum + r.driven, 0) : null,
    vehicleDriven: models.length > 0 ? models.join(" / ") : null,
    actualPickupLocal: times[0] ?? null,
    actualReturnLocal: times[1] ?? null,
    finalAmount,
    finalCurrency: finalAmount !== null ? "EUR" : null,
  };
}
