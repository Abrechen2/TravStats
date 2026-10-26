import type { JSX } from "react";

import DocumentsSection from "../documents/DocumentsSection";
import { RowActionButton, RowActions } from "../table/RowActionButton";
import { statusPillStyle } from "../table/statusPillStyle";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { PlaceVisit } from "../../types/place";
import type { VisitEntry } from "./placeVisitListModel";
import { VisitPhotoStrip } from "./VisitPhotoStrip";

interface Props {
  entry: VisitEntry;
  open: boolean;
  onToggle: () => void;
  tripName: string | null;
  onEdit: (visit: PlaceVisit) => void;
  onDelete: (visit: PlaceVisit) => void;
  /** A photo or document of this visit changed — the page re-reads the place. */
  onChanged: () => void;
}

const CHIP = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs";

/**
 * One visit: a summary that is itself the toggle, the two actions beside it,
 * and — only while open — the detail panel. The photo strip and the documents
 * section fetch on mount, so they mount for the open row only; a place with
 * eighty visits used to mount eighty documents sections at once.
 */
export function PlaceVisitRow({
  entry,
  open,
  onToggle,
  tripName,
  onEdit,
  onDelete,
  onChanged,
}: Props): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const fmt = useDisplayFormat();
  const { visit, state, day, clock, daysAhead } = entry;
  const panelId = `visit-panel-${visit.id}`;
  const dateText = day ? fmt.localDate(day, { weekday: true }) : t("places:visitList.undated");
  const timeText = clock ? fmt.localClock(clock) : null;
  const note = visit.notes?.trim() ?? "";
  const photoCount = visit.photos?.length ?? 0;
  const documentCount = visit.documentCount ?? 0;
  const rating = visit.rating !== null && visit.rating > 0 ? Math.min(5, visit.rating) : null;
  const hasTrip = visit.tripId !== null && tripName !== null;
  const hasMeta = hasTrip || photoCount > 0 || documentCount > 0 || rating !== null;
  const labelDate = day ? fmt.localDate(day) : null;

  const plannedLabel =
    daysAhead === null || daysAhead <= 0
      ? t("places:visitList.plannedToday")
      : daysAhead === 1
        ? t("places:visitList.plannedTomorrow")
        : t("places:visitList.plannedInDays", { count: daysAhead });

  return (
    <li className="rounded-md" data-testid={`visit-row-${visit.id}`}>
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md px-2 py-3 text-left hover:bg-(--ts-row-hover)"
          style={{ minHeight: "var(--ts-size-touch-min)" }}
        >
          <span className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span
              className="whitespace-nowrap text-[15px] font-semibold"
              style={{
                fontFamily: "var(--ts-font-mono)",
                color: day ? "var(--ts-text-bright)" : "var(--ts-muted)",
              }}
            >
              {dateText}
            </span>
            {timeText && (
              <span
                className="text-sm"
                style={{ fontFamily: "var(--ts-font-mono)", color: "var(--ts-muted)" }}
              >
                {timeText}
              </span>
            )}
            {state === "planned" && (
              <span className="ts-status-pill shrink-0" style={statusPillStyle("scheduled")}>
                {plannedLabel}
              </span>
            )}
            {note && (
              <span
                className="min-w-0 max-w-full truncate text-sm"
                style={{ color: "var(--ts-text)" }}
              >
                {note.split("\n")[0]}
              </span>
            )}
          </span>
          {hasMeta && (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              {hasTrip && (
                <span
                  className={`${CHIP} font-semibold`}
                  style={{ background: "rgba(240,169,71,0.13)", color: "var(--accent)" }}
                >
                  🧳 {t("places:visitList.trip", { name: tripName })}
                </span>
              )}
              {photoCount > 0 && (
                <span className={CHIP} style={{ border: "1px solid var(--ts-border)" }}>
                  {t("places:visitList.photos", { count: photoCount })}
                </span>
              )}
              {documentCount > 0 && (
                <span className={CHIP} style={{ border: "1px solid var(--ts-border)" }}>
                  {t("places:visitList.documents", { count: documentCount })}
                </span>
              )}
              {rating !== null && (
                <span className="whitespace-nowrap text-[13px] tracking-[1px]">
                  <span aria-hidden="true" style={{ color: "var(--accent)" }}>
                    {"★".repeat(rating)}
                  </span>
                  <span aria-hidden="true" style={{ color: "var(--ts-faint)" }}>
                    {"★".repeat(5 - rating)}
                  </span>
                  <span className="sr-only">{t("places:visitList.rating", { rating })}</span>
                </span>
              )}
            </span>
          )}
        </button>
        <div className="shrink-0 pt-0.5">
          <RowActions>
            <RowActionButton
              icon="edit"
              size="touch"
              label={
                labelDate
                  ? t("places:visitList.edit", { date: labelDate })
                  : t("places:visitList.editUndated")
              }
              onClick={() => onEdit(visit)}
            />
            <RowActionButton
              icon="delete"
              size="touch"
              label={
                labelDate
                  ? t("places:visitList.delete", { date: labelDate })
                  : t("places:visitList.deleteUndated")
              }
              onClick={() => onDelete(visit)}
            />
          </RowActions>
        </div>
      </div>
      {open && (
        <div
          id={panelId}
          data-testid={panelId}
          className="mx-2 mb-3 flex flex-col gap-3.5 rounded-md px-4 py-3.5"
          style={{ background: "var(--ts-surface2)", border: "1px solid var(--ts-border)" }}
        >
          {note && (
            <div className="flex flex-col gap-1">
              <h4 className="t-label-mono">{t("places:detail.notes")}</h4>
              <p className="whitespace-pre-line text-sm" style={{ color: "var(--ts-text)" }}>
                {note}
              </p>
            </div>
          )}
          {/* Proof hangs off the VISIT, not the place, and a picture of a
              visit that has not happened is not a thing — so no strip for a
              planned one. The strip carries the photo suggestions (trip
              photos and the photo library), with or without a trip. */}
          {state !== "planned" && (
            <VisitPhotoStrip visitId={visit.id} photos={visit.photos ?? []} onChanged={onChanged} />
          )}
          {/* Not guarded by the state, unlike the photographs: a ticket exists
              BEFORE the day it is used, and that is the commonest reason to
              keep one at all. */}
          <DocumentsSection
            entry={{ type: "placeVisit", id: visit.id }}
            layout="inline"
            onChanged={onChanged}
          />
        </div>
      )}
    </li>
  );
}
