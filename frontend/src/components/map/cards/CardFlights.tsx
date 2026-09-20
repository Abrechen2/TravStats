// The compact flight list a route card and a trip card both carry.
//
// Its own module because both bodies use it and they now live in two files
// (`PinnedCard.tsx` and `cardBodies.tsx`) — importing it from one into the
// other would make the split look like a hierarchy it is not.

import { useState, type JSX } from "react";
import type { GeoJSONFeature } from "../../../types";
import { tokens } from "../../../theme/tokens";
import { LABEL_STYLE, formatDate, type TFn } from "./cardChrome";

const ARC_FLIGHTS_COLLAPSED = 2;

/** Compact flight list on the card — airline name + number + date. Shows the
 *  two most recent by default; a "Liste (+N)" button reveals the rest inline
 *  (scrollable), so the card never runs off-screen. */
export function CardFlights({
  flights,
  flightIds,
  locale,
  t,
}: {
  flights: GeoJSONFeature[];
  flightIds: string[];
  locale: string;
  t: TFn;
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const ids = new Set(flightIds);
  const rows = flights
    .filter((f) => ids.has(f.properties.id))
    .sort((a, b) =>
      (b.properties.departureTime ?? "").localeCompare(a.properties.departureTime ?? "")
    );
  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, ARC_FLIGHTS_COLLAPSED);
  const more = rows.length - ARC_FLIGHTS_COLLAPSED;

  return (
    <div className="mt-2 border-t pt-2" style={{ borderColor: tokens.color.border }}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span style={LABEL_STYLE}>{t("map:globe.pinned.flightsOnRoute")}</span>
        {more > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="cursor-pointer text-[10px] font-medium"
            style={{ color: tokens.color.accent }}
          >
            {expanded
              ? t("map:globe.pinned.flightListHide")
              : t("map:globe.pinned.flightListShow", { count: more })}
          </button>
        )}
      </div>
      <div className="space-y-1 overflow-y-auto" style={{ maxHeight: expanded ? 132 : undefined }}>
        {shown.map((f) => (
          <div key={f.properties.id} className="flex items-center gap-2 text-[11px]">
            <span className="font-medium">{f.properties.airline ?? "—"}</span>
            <span className="font-mono opacity-50">{f.properties.flightNumber ?? ""}</span>
            <span className="ml-auto tabular-nums opacity-55">
              {f.properties.departureTime ? formatDate(f.properties.departureTime, locale) : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
