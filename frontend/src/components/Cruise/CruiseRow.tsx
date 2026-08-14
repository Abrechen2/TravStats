import type { Cruise } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { cruiseStatusPillStyle } from "./cruiseStatusStyle";
import { countUniquePorts } from "./cruisePorts";
import { formatCurrency } from "../../lib/units";

interface Props {
  cruise: Cruise;
  onOpen: () => void;
  actions?: JSX.Element;
}

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 10);
};

export function CruiseRow({ cruise, onOpen, actions }: Props): JSX.Element {
  const { t } = useTranslation("cruise");
  const portsCount = countUniquePorts(cruise);
  const displayLine = cruise.cruiseLine ?? cruise.ship?.cruiseLine ?? "—";
  const displayShip = cruise.ship?.name ?? cruise.shipNameOverride ?? "—";
  // Through the shared formatter, like every other price in the app: this row
  // used to print "3290.00 EUR" — two fixed decimals whatever the currency
  // (a yen amount has none), the code instead of the symbol, and the
  // machine's decimal point inside a German page.
  const price =
    cruise.price !== null ? formatCurrency(cruise.price, cruise.currency ?? "EUR") : "—";
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-t border-border hover:bg-(--bg-surface)/50"
    >
      <td className="px-3 py-2 text-sm text-(--text-primary)">{displayShip}</td>
      <td className="px-3 py-2 text-sm text-(--text-muted)">{displayLine}</td>
      <td className="px-3 py-2 text-sm text-(--text-muted)">
        {fmtDate(cruise.startDate)} – {fmtDate(cruise.endDate)}
      </td>
      <td className="px-3 py-2 text-sm text-(--text-muted)">{portsCount}</td>
      <td className="px-3 py-2 text-sm">
        <span
          className="rounded-full px-2 py-1 text-xs font-semibold"
          style={cruiseStatusPillStyle(cruise.status)}
        >
          {t(`status.${cruise.status}`)}
        </span>
      </td>
      <td className="px-3 py-2 text-sm text-(--text-muted)">{cruise.cabinNumber ?? "—"}</td>
      <td className="px-3 py-2 text-right text-sm text-(--text-muted)">{price}</td>
      <td className="px-3 py-2 text-right text-sm" onClick={(e) => e.stopPropagation()}>
        {actions}
      </td>
    </tr>
  );
}
