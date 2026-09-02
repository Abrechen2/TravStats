import type { FlaggedRecord } from "../../types/dataQuality";

/**
 * Where a flagged record lives, so the inbox can reach it.
 *
 * Design §3.4 is the whole reason this file exists: *"immer schauen dass der
 * User sieht wie die Namen herkommen und veränderbar sind"*. Naming a record
 * without reaching it turns a diagnosis into a dead end — the Bucharest hotel
 * took a database session to find, and after this it should take two clicks.
 *
 * Both targets are the record's own detail page, and both carry an edit button
 * on them: `/lodging/:id` opens the lodging form AND the stay editor (which is
 * why `stay_dates_reversed` flags the house rather than the stay), `/places/:id`
 * opens the place form.
 *
 * A `country` cannot arrive here at all: it is not a row, `FlaggedRecord` no
 * longer admits one, and this function therefore always has a page to return.
 * That is not a gap — a country flag carries `details.records`, and each of
 * THOSE is a lodging or a place that resolves here.
 */
export function flaggedRecordPath(record: FlaggedRecord): string {
  switch (record.entityType) {
    case "lodging":
      return `/lodging/${record.entityId}`;
    case "place":
      return `/places/${record.entityId}`;
  }
}
