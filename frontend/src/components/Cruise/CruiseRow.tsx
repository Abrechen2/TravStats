import type { Cruise } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

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
  const portsCount = cruise.stops.filter((s) => !s.isAtSea).length;
  const displayLine = cruise.cruiseLine ?? cruise.ship?.cruiseLine ?? "—";
  const displayShip = cruise.ship?.name ?? cruise.shipNameOverride ?? "—";
  const price = cruise.price !== null ? `${cruise.price.toFixed(2)} ${cruise.currency ?? ""}` : "—";
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-t border-neutral-800 hover:bg-neutral-900/50"
    >
      <td className="px-3 py-2 text-sm text-neutral-100">{displayShip}</td>
      <td className="px-3 py-2 text-sm text-neutral-300">{displayLine}</td>
      <td className="px-3 py-2 text-sm text-neutral-300">
        {fmtDate(cruise.startDate)} – {fmtDate(cruise.endDate)}
      </td>
      <td className="px-3 py-2 text-sm text-neutral-300">{portsCount}</td>
      <td className="px-3 py-2 text-sm">
        <span className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-300">
          {t(`status.${cruise.status}`)}
        </span>
      </td>
      <td className="px-3 py-2 text-sm text-neutral-300">{cruise.cabinNumber ?? "—"}</td>
      <td className="px-3 py-2 text-right text-sm text-neutral-300">{price}</td>
    </tr>
  );
}
