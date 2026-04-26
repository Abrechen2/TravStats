import type { Cruise } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { cruiseStatusPillStyle } from "./cruiseStatusStyle";

interface Props {
  cruise: Cruise;
  onOpen: () => void;
}

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 10);
};

export function CruiseRow({ cruise, onOpen }: Props): JSX.Element {
  const { t } = useTranslation("cruise");
  // Count unique ports across departure / arrival / port-call stops. The
  // bare stops filter undercounts cruises whose itinerary lives in
  // departurePort + arrivalPort only (e.g. PDF imports with no detailed
  // stop list, or simple A-to-B trips). De-duplicate by portId so a
  // round-trip with the same departure/arrival port still reads "1".
  const portIds = new Set<number>();
  if (cruise.departurePort?.id != null) portIds.add(cruise.departurePort.id);
  if (cruise.arrivalPort?.id != null) portIds.add(cruise.arrivalPort.id);
  for (const stop of cruise.stops) {
    if (!stop.isAtSea && stop.port?.id != null) portIds.add(stop.port.id);
  }
  const portsCount = portIds.size;
  const displayLine = cruise.cruiseLine ?? cruise.ship?.cruiseLine ?? "—";
  const displayShip = cruise.ship?.name ?? cruise.shipNameOverride ?? "—";
  const price = cruise.price !== null ? `${cruise.price.toFixed(2)} ${cruise.currency ?? ""}` : "—";
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-t border-[var(--color-border)] hover:bg-[var(--bg-surface)]/50"
    >
      <td className="px-3 py-2 text-sm text-[var(--text-primary)]">{displayShip}</td>
      <td className="px-3 py-2 text-sm text-[var(--text-muted)]">{displayLine}</td>
      <td className="px-3 py-2 text-sm text-[var(--text-muted)]">
        {fmtDate(cruise.startDate)} – {fmtDate(cruise.endDate)}
      </td>
      <td className="px-3 py-2 text-sm text-[var(--text-muted)]">{portsCount}</td>
      <td className="px-3 py-2 text-sm">
        <span
          className="rounded-full px-2 py-1 text-xs font-semibold"
          style={cruiseStatusPillStyle(cruise.status)}
        >
          {t(`status.${cruise.status}`)}
        </span>
      </td>
      <td className="px-3 py-2 text-sm text-[var(--text-muted)]">{cruise.cabinNumber ?? "—"}</td>
      <td className="px-3 py-2 text-right text-sm text-[var(--text-muted)]">{price}</td>
    </tr>
  );
}
