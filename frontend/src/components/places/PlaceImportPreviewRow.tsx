import type { JSX } from "react";
import { LocationInput, type LocationSelection } from "../location/LocationInput";
import type { ResolvableRow, RowDecision } from "../../lib/placeImportTakeout";

/**
 * One row of the place import preview. Split out of `PlaceImportPreviewModal`
 * when the Google Takeout suggestions (#358) added their badges and the
 * trip-stop / stay choices.
 */

export interface EditableRow extends ResolvableRow {
  /** The position picker is open under this row. */
  picking: boolean;
}

const INPUT =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none";

const BADGE = "rounded px-1.5 py-0.5 text-[10px]";
const WARN = `${BADGE} bg-(--warning)/15 text-(--warning)`;
const GOOD = `${BADGE} bg-(--success)/15 text-(--success)`;
const INFO = `${BADGE} bg-(--accent-soft) text-(--accent)`;

export function rowHasPosition<T extends { lat?: number | null; lon?: number | null }>(
  row: T
): row is T & { lat: number; lon: number } {
  return (
    typeof row.lat === "number" &&
    typeof row.lon === "number" &&
    Number.isFinite(row.lat) &&
    Number.isFinite(row.lon)
  );
}

interface Props {
  row: EditableRow;
  onChange: (sourceRowIndex: number, patch: Partial<EditableRow>) => void;
  onPlace: (row: EditableRow, sel: LocationSelection) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  /** Tablet fingers: taller controls (`useCoarsePointer`). */
  coarse: boolean;
}

/** The suggestion badges a resolved Takeout row carries — each one visible. */
function TakeoutBadges({ row, t }: Pick<Props, "row" | "t">): JSX.Element | null {
  const note = row.takeout;
  if (!note) return null;
  const k = "places:import.takeout";
  return (
    <>
      {note.positionSource && (
        <span data-testid={`place-import-source-${row.sourceRowIndex}`} className={GOOD}>
          {t(`${k}.sources.${note.positionSource}`)}
        </span>
      )}
      {note.positionReason && (
        <span data-testid={`place-import-reason-${row.sourceRowIndex}`} className={WARN}>
          {t(`${k}.positionReasons.${note.positionReason}`)}
        </span>
      )}
      {note.kind !== "sight" && <span className={INFO}>{t(`${k}.kinds.${note.kind}`)}</span>}
      {note.matchedStayName && (
        <span className={INFO}>{t(`${k}.matchedStay`, { name: note.matchedStayName })}</span>
      )}
    </>
  );
}

function VisitDayCell({ row, t }: Pick<Props, "row" | "t">): JSX.Element {
  const note = row.takeout;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-xs text-[var(--text-muted)]">{row.visitedAt ?? "—"}</span>
      {note?.photoCount != null && (
        <span data-testid={`place-import-day-${row.sourceRowIndex}`} className={GOOD}>
          {t("places:import.takeout.dayFromPhotos", { count: note.photoCount })}
        </span>
      )}
      {note?.visitDayReason && (
        <span className="text-[10px] text-[var(--text-muted)]">
          {t(`places:import.takeout.dayReasons.${note.visitDayReason}`)}
        </span>
      )}
    </div>
  );
}

export function PlaceImportPreviewRow({ row, onChange, onPlace, t, coarse }: Props): JSX.Element {
  const { sourceRowIndex } = row;
  const positioned = rowHasPosition(row);
  const undecided = row.decision === "";
  const rowClass = undecided
    ? "border-t border-[var(--color-border)] bg-(--warning)/5"
    : "border-t border-[var(--color-border)]";
  const control = coarse ? `${INPUT} min-h-11` : INPUT;

  return (
    <>
      <tr className={rowClass}>
        <td className="p-2">
          <input
            data-testid={`place-import-name-${sourceRowIndex}`}
            value={row.name}
            onChange={(e): void => onChange(sourceRowIndex, { name: e.target.value })}
            aria-label={t("places:import.fields.name")}
            className={control}
          />
        </td>
        <td className="p-2 whitespace-nowrap">
          {positioned ? (
            <span
              data-testid={`place-import-position-${sourceRowIndex}`}
              className="font-mono text-xs text-[var(--text-primary)]"
            >
              {row.lat.toFixed(4)} · {row.lon.toFixed(4)}
            </span>
          ) : (
            <button
              type="button"
              data-testid={`place-import-pick-${sourceRowIndex}`}
              onClick={(): void => onChange(sourceRowIndex, { picking: !row.picking })}
              className={`rounded-md border border-(--warning)/40 px-2 text-xs text-(--warning) hover:bg-(--warning)/10 ${coarse ? "min-h-11" : "py-1"}`}
            >
              {t("places:import.pickPosition")}
            </button>
          )}
        </td>
        <td className="p-2 text-[var(--text-muted)]">
          {[row.city, row.country].filter(Boolean).join(" · ") || "—"}
        </td>
        <td className="p-2">
          <VisitDayCell row={row} t={t} />
        </td>
        <td className="p-2">
          <div className="flex flex-wrap gap-1">
            {row.flags.map((flag) => (
              <span key={flag} className={WARN}>
                {t(`places:import.flags.${flag}`)}
              </span>
            ))}
            {row.dedupeHint !== "none" && (
              <span className={GOOD}>{t(`places:import.dedupeHints.${row.dedupeHint}`)}</span>
            )}
            <TakeoutBadges row={row} t={t} />
          </div>
        </td>
        <td className="p-2">
          <select
            data-testid={`place-import-action-${sourceRowIndex}`}
            value={row.decision}
            onChange={(e): void =>
              onChange(sourceRowIndex, { decision: e.target.value as RowDecision })
            }
            aria-label={t("places:import.fields.action")}
            className={control}
          >
            <option value="">{t("places:import.actions.choose")}</option>
            {/* "Create" only once the row can be created: a Place is a point,
                and the backend would refuse the row as `no_position`. A stop
                needs a point AND a trip; "my stay" needs the stay found. */}
            {positioned && <option value="create">{t("places:import.actions.create")}</option>}
            {positioned && row.tripId && (
              <option value="trip_stop">{t("places:import.actions.trip_stop")}</option>
            )}
            {row.lodgingStayId && <option value="stay">{t("places:import.actions.stay")}</option>}
            <option value="skip">{t("places:import.actions.skip")}</option>
          </select>
        </td>
      </tr>
      {row.picking && !positioned && (
        <tr className="border-t border-[var(--color-border)] bg-(--warning)/5">
          <td colSpan={6} className="p-3">
            <LocationInput
              value={null}
              onChange={(sel): void => onPlace(row, sel)}
              compact
              idPrefix={`place-import-${sourceRowIndex}`}
              label={t("places:import.pickPositionFor", { name: row.name })}
            />
          </td>
        </tr>
      )}
    </>
  );
}
