import type { JSX } from "react";

import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { dayKey } from "../../lib/roadtrip/roadtripView";
import {
  isProtectedSource,
  type LegChange,
  type ReorderImpact,
  type ReorderStation,
} from "../../lib/roadtrip/reorderImpact";

/**
 * The question before a station moves (forgejo#242): its new neighbours, the
 * legs that go and the ones that come, and the dates that would then read
 * backwards. A leg whose line came from a recording or was drawn by hand is
 * named as such and said to be lost — and the confirm button says so too, so
 * it cannot be overwritten by a press that only meant "move this up".
 */
export default function ReorderPreviewDialog({
  impact,
  onConfirm,
  onClose,
}: {
  impact: ReorderImpact;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  const display = useDisplayFormat();
  const name = (s: ReorderStation): string =>
    s.title.trim() ||
    (s.night.kind === "via" ? t("roadtrips:night.via") : t("roadtrips:editor.unnamed"));
  const day = (s: ReorderStation): string => {
    const key = dayKey(s.startDate ?? null);
    return key ? display.date(`${key}T00:00:00Z`, { timeZone: "UTC", omitYear: true }) : "";
  };

  const neighbours =
    impact.before && impact.after
      ? t("roadtrips:reorder.between", { before: name(impact.before), after: name(impact.after) })
      : impact.after
        ? t("roadtrips:reorder.first", { after: name(impact.after) })
        : t("roadtrips:reorder.last", { before: impact.before ? name(impact.before) : "" });

  const legRow = (change: LegChange): JSX.Element => {
    const source = change.leg?.source ?? null;
    const guarded = source !== null && isProtectedSource(source);
    return (
      <li
        key={`${change.from.key}>${change.to.key}`}
        className="flex flex-col"
        style={{ gap: 2 }}
        data-protected={guarded ? "true" : undefined}
      >
        <span className="flex flex-wrap items-center" style={{ gap: 8 }}>
          <span style={{ fontWeight: 700 }}>
            {name(change.from)} → {name(change.to)}
          </span>
          {change.leg && <span className="t-caption">{Math.round(change.leg.distanceKm)} km</span>}
          {source && (
            <span
              style={{
                fontSize: 12,
                padding: "1px 8px",
                borderRadius: 999,
                border: `1px solid ${guarded ? "var(--ts-warn)" : "var(--ts-border)"}`,
                color: guarded ? "var(--ts-warn)" : "var(--ts-muted)",
              }}
            >
              {t(`roadtrips:reorder.source.${source}`)}
            </span>
          )}
        </span>
        {guarded && (
          <span style={{ fontSize: 13, color: "var(--ts-warn)" }}>
            {t(source === "track" ? "roadtrips:reorder.lossTrack" : "roadtrips:reorder.lossDrawn")}
          </span>
        )}
      </li>
    );
  };

  const savedDropped = impact.dropped.filter((d) => d.leg !== null);

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth={560}
      title={t("roadtrips:reorder.title", { name: name(impact.moved) })}
      closeLabel={t("common:buttons.close")}
      dismissLabel={t("common:buttons.cancel")}
      action={
        <Button variant="primary" onClick={onConfirm}>
          {impact.losesLine ? t("roadtrips:reorder.confirmLoss") : t("roadtrips:reorder.confirm")}
        </Button>
      }
    >
      <div className="flex flex-col" style={{ gap: 14 }}>
        <p>{neighbours}</p>
        <section className="flex flex-col" style={{ gap: 6 }}>
          <h3 className="t-label-mono">{t("roadtrips:reorder.droppedTitle")}</h3>
          {savedDropped.length === 0 ? (
            <p className="t-caption">{t("roadtrips:reorder.noLegs")}</p>
          ) : (
            <ul className="flex flex-col" style={{ gap: 8, listStyle: "none", padding: 0 }}>
              {savedDropped.map(legRow)}
            </ul>
          )}
        </section>
        {impact.created.length > 0 && (
          <section className="flex flex-col" style={{ gap: 6 }}>
            <h3 className="t-label-mono">{t("roadtrips:reorder.createdTitle")}</h3>
            <ul className="flex flex-col" style={{ gap: 4, listStyle: "none", padding: 0 }}>
              {impact.created.map((c) => (
                <li key={`${c.from.key}>${c.to.key}`}>
                  {name(c.from)} → {name(c.to)}
                </li>
              ))}
            </ul>
          </section>
        )}
        {impact.dateConflicts.length > 0 && (
          <section className="flex flex-col" style={{ gap: 6 }} role="alert">
            <h3 className="t-label-mono" style={{ color: "var(--ts-warn)" }}>
              {t("roadtrips:reorder.dateConflictsTitle")}
            </h3>
            {impact.dateConflicts.map((c) => (
              <p key={c.station.key} style={{ fontSize: 13, color: "var(--ts-warn)" }}>
                {t("roadtrips:reorder.dateConflict", {
                  name: name(c.station),
                  date: day(c.station),
                  previous: name(c.previous),
                  previousDate: day(c.previous),
                })}
              </p>
            ))}
          </section>
        )}
        <p className="t-caption">{t("roadtrips:reorder.undoNote")}</p>
      </div>
    </Dialog>
  );
}
