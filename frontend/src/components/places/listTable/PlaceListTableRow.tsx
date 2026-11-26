import { Fragment, type JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { FlagImg } from "../../../lib/countryFlag";
import { formatLocalDate } from "../../../lib/format";
import type { ListMemberRow, ListMembersPage } from "../../../types/placeList";

const COARSE =
  "pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:min-w-(--ts-size-touch-min)";
const CELL = "px-3 py-2 align-middle";

const day = (d: string | null): string => (d ? formatLocalDate(d) : "—");

/** One member: the whole row opens the place; its name is the keyboard link. */
export default function PlaceListTableRow({
  row,
  columns,
  showDistance,
  icon,
  expanded,
  onToggle,
  onRemove,
  move,
}: {
  row: ListMemberRow;
  columns: ListMembersPage["columns"];
  showDistance: boolean;
  icon: string;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  /** Only in "Eigene Reihenfolge": up/down, null at the ends. */
  move: { up: (() => void) | null; down: (() => void) | null } | null;
}): JSX.Element {
  const { t, i18n } = useTranslation(["places"]);
  const navigate = useNavigate();
  const lang = i18n?.language?.startsWith("en") ? "en" : "de";
  const to = `/places/${row.placeId}`;
  const span = 8 + columns.length + (showDistance ? 1 : 0);

  return (
    <Fragment>
      <tr
        data-testid="place-list-row"
        className="cursor-pointer hover:bg-(--bg-surface)"
        style={{ borderTop: "1px solid var(--color-border)" }}
        onClick={(e) => {
          // A button or link in the row does its own thing.
          if ((e.target as HTMLElement).closest("button, a")) return;
          navigate(to);
        }}
      >
        <td className={`${CELL} min-w-40`}>
          <span className="inline-flex items-start gap-2">
            <span aria-hidden>{icon}</span>
            <Link to={to} className="text-sm" style={{ color: "var(--text-primary)" }}>
              {row.name}
            </Link>
          </span>
        </td>
        <td className={`${CELL} text-sm`} style={{ color: "var(--text-secondary)" }}>
          <span className="inline-flex items-center gap-1">
            {(row.countryCode || row.country) && (
              <FlagImg country={row.countryCode ?? row.country} />
            )}
            {row.country ?? row.countryCode ?? "—"}
          </span>
        </td>
        <td className={`${CELL} text-sm`} style={{ color: "var(--text-secondary)" }}>
          {row.city ?? "—"}
        </td>
        <td className={CELL}>
          <button
            type="button"
            onClick={onToggle}
            disabled={row.visitCount === 0}
            aria-expanded={expanded}
            aria-label={t("places:lists.table.visitsToggle", {
              count: row.visitCount,
              name: row.name,
            })}
            className={`rounded px-2 text-sm disabled:cursor-default ${COARSE}`}
            style={{ color: "var(--text-primary)" }}
            data-testid="place-list-visits"
          >
            {row.visitCount}
            {row.visitCount > 0 && <span aria-hidden> {expanded ? "▾" : "▸"}</span>}
          </button>
        </td>
        <td className={`${CELL} text-sm`}>{day(row.lastVisit)}</td>
        <td className={`${CELL} text-sm`}>{day(row.firstVisit)}</td>
        <td className={`${CELL} text-xs`} style={{ color: "var(--text-muted)" }}>
          {t(`places:lists.table.source.${row.source}`)}
        </td>
        {showDistance && (
          <td className={`${CELL} text-sm tabular-nums`}>
            {row.distanceKm === null
              ? "—"
              : `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(row.distanceKm)} km`}
          </td>
        )}
        {columns.map((c) => (
          <td key={c.key} className={`${CELL} text-sm`}>
            {row.external?.fields[c.key] ?? "—"}
          </td>
        ))}
        <td className={`${CELL} whitespace-nowrap text-right`}>
          {move && (
            <>
              <button
                type="button"
                onClick={move.up ?? undefined}
                disabled={!move.up}
                aria-label={t("places:lists.moveUp", { name: row.name })}
                className={`px-1 text-sm disabled:opacity-30 ${COARSE}`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={move.down ?? undefined}
                disabled={!move.down}
                aria-label={t("places:lists.moveDown", { name: row.name })}
                className={`px-1 text-sm disabled:opacity-30 ${COARSE}`}
              >
                ↓
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onRemove}
            aria-label={t("places:lists.removeFromList", { name: row.name })}
            className={`px-1 text-sm ${COARSE}`}
            style={{ color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </td>
      </tr>
      {expanded && (
        <tr data-testid="place-list-visit-dates">
          <td colSpan={span} className="px-3 pb-3">
            <ul className="flex flex-wrap gap-2" style={{ listStyle: "none", padding: 0 }}>
              {row.visits.map((v) => (
                <li key={v.id}>
                  <Link
                    to={`${to}#visit-${v.id}`}
                    className="rounded-full px-2 py-0.5 text-xs"
                    style={{ border: "1px solid var(--color-border)" }}
                  >
                    {day(v.date)}
                  </Link>
                </li>
              ))}
              {row.visitCount > row.visits.length && (
                <li className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("places:lists.table.moreVisits", {
                    count: row.visitCount - row.visits.length,
                  })}
                </li>
              )}
            </ul>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
