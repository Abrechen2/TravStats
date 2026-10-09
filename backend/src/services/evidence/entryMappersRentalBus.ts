import type { EvidenceEntry } from "../../schemas/evidence";
import { localDay } from "../../shared/time/instant";

/**
 * Row → `EvidenceEntry` for rentals and bus rides (forgejo#262, #263) — the
 * siblings of `railEvidenceEntry`. Both link to their own page and are dated
 * on the day the domain files them under: a rental on its pickup station's
 * calendar, a bus ride on its departure terminal's (zone-less = UTC, the
 * domain's abstention).
 */

type EntryFields = Pick<EvidenceEntry, "contribution" | "credits" | "creditLabels">;

const withFields = (entry: EvidenceEntry, fields: EntryFields): EvidenceEntry => ({
  ...entry,
  ...(fields.contribution === undefined ? {} : { contribution: fields.contribution }),
  ...(fields.credits === undefined ? {} : { credits: fields.credits }),
  ...(fields.creditLabels === undefined ? {} : { creditLabels: fields.creditLabels }),
});

export interface RentalEvidenceRow {
  id: string;
  provider: string;
  pickupStationName: string;
  returnStationName: string;
  pickupTime: Date;
  pickupTimezone: string;
}

export function rentalEvidenceEntry(row: RentalEvidenceRow, fields: EntryFields): EvidenceEntry {
  const route =
    row.pickupStationName === row.returnStationName
      ? row.pickupStationName
      : `${row.pickupStationName} → ${row.returnStationName}`;
  return withFields(
    {
      domain: "rental",
      id: row.id,
      href: `/rentals/${row.id}`,
      // The provider and the station names are the traveller's data, not copy.
      title: { text: `${row.provider} · ${route}` },
      subtitle: null,
      date: { value: localDay(row.pickupTime, row.pickupTimezone), precision: "day" },
    },
    fields
  );
}

export interface BusEvidenceRow {
  id: string;
  operator: string | null;
  depStationName: string;
  arrStationName: string;
  departureTime: Date;
  depTimezone: string | null;
}

export function busEvidenceEntry(row: BusEvidenceRow, fields: EntryFields): EvidenceEntry {
  const route = `${row.depStationName} → ${row.arrStationName}`;
  return withFields(
    {
      domain: "bus",
      id: row.id,
      href: `/bus/${row.id}`,
      title: { text: row.operator?.trim() ? `${row.operator.trim()} · ${route}` : route },
      subtitle: null,
      date: { value: localDay(row.departureTime, row.depTimezone ?? "UTC"), precision: "day" },
    },
    fields
  );
}
