import type { JSX } from "react";
import type { Cruise } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { buildEffectiveTimeline } from "./cruisePorts";

/**
 * HH:MM as entered. Stop times are wall-clock values stored with a Z suffix
 * (the stops editor reads and writes `slice(0, 16)`), so converting them into
 * the port's zone would shift every time — Miami's 00:00 became 19:00.
 */
function clock(iso: string | null | undefined): string | null {
  return iso && iso.length >= 16 ? iso.slice(11, 16) : null;
}

/** DD.MM. — the year is in the head already. */
function dayMonth(iso: string | null): string | null {
  if (!iso) return null;
  const [, m, d] = iso.slice(0, 10).split("-");
  return m && d ? `${d}.${m}.` : null;
}

/**
 * The port sequence as round 4 draws it ("Kreuzfahrt Detail"): one row per
 * day with day number and date on the left, a dot on a rail (hollow for a sea
 * day), the port and its country, and arrival · departure on the right.
 *
 * It replaces a generic timeline of bordered cards inside the section card —
 * a card per port inside a card, where the times a reader looks for were not
 * shown at all.
 */
export default function CruiseItinerary({ cruise }: { cruise: Cruise }): JSX.Element {
  const { t } = useTranslation("cruise");
  const entries = buildEffectiveTimeline(cruise);

  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => {
        const arrive = clock(entry.stop?.arrivalTime);
        const depart = clock(entry.stop?.departureTime);
        const title = entry.isAtSea
          ? t("stops.at_sea")
          : (entry.port?.name ?? entry.unresolvedPortName ?? "—");
        const sub = entry.isAtSea
          ? null
          : entry.port
            ? [entry.port.city !== entry.port.name ? entry.port.city : null, entry.port.country]
                .filter(Boolean)
                .join(", ")
            : t("stops.unresolved");
        const last = index === entries.length - 1;
        return (
          <li
            key={entry.key}
            className="grid items-start"
            style={{
              gridTemplateColumns: "56px 16px minmax(0,1fr) auto",
              columnGap: "var(--ts-space-md)",
            }}
          >
            <span
              className="t-caption"
              style={{ fontFamily: "var(--ts-font-mono)", lineHeight: 1.3, paddingTop: 2 }}
            >
              {entry.stop ? `${t("detail.day")} ${entry.stop.dayNumber}` : null}
              <br />
              <span style={{ color: "var(--ts-text)" }}>{dayMonth(entry.date)}</span>
            </span>
            <span className="flex h-full flex-col items-center" aria-hidden="true">
              <span
                style={{
                  width: 10,
                  height: 10,
                  marginTop: 5,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: entry.isAtSea ? "transparent" : "var(--ts-domain-cruise)",
                  border: "2px solid var(--ts-domain-cruise)",
                  opacity: entry.isAtSea ? 0.6 : 1,
                }}
              />
              {!last && (
                <span
                  style={{
                    flex: 1,
                    width: 2,
                    minHeight: 24,
                    background: "var(--ts-domain-cruise)",
                    opacity: 0.35,
                  }}
                />
              )}
            </span>
            <span className="flex min-w-0 flex-col" style={{ paddingBottom: last ? 0 : 14 }}>
              <span
                className="truncate"
                style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}
              >
                {title}
              </span>
              {sub ? <span className="t-caption truncate">{sub}</span> : null}
              {entry.excursionNote ? (
                <span className="t-caption" style={{ color: "var(--ts-text)" }}>
                  {entry.excursionNote}
                </span>
              ) : null}
            </span>
            <span
              className="t-caption whitespace-nowrap"
              style={{ fontFamily: "var(--ts-font-mono)", paddingTop: 2 }}
            >
              {arrive || depart ? `${arrive ?? "—"} · ${depart ?? "—"}` : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
