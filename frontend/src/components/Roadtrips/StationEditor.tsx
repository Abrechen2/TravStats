import { useEffect, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";

import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import { stationAfter, stationWarnings } from "../../lib/roadtrip/roadtripView";
import type { RoadtripStation } from "../../types/roadtrip";
import type { TourLeg } from "../../types/tour";
import StationEditCard from "./StationEditCard";
import StationMarker from "./StationMarker";
import { useLodgingLibrary } from "./StayPicker";
import {
  newStationKey,
  toEditorStation,
  useStationAutosave,
  type EditorStation,
  type SaveStatus,
  type SavedStations,
} from "./useStationAutosave";

const UNDO_MS = 8000;

const DASHED: CSSProperties = {
  minHeight: 40,
  borderRadius: "var(--ts-radius-button)",
  background: "none",
  border: "1px dashed color-mix(in srgb, var(--domain-roadtrip) 50%, transparent)",
  color: "var(--domain-roadtrip)",
  fontSize: 13,
  cursor: "pointer",
};

/** How the editor opens: plainly, with a new station, or with tonight's. */
export type EditorStart = "plain" | "new" | "today";

/**
 * The stations of a roadtrip, edited in place (design 2026-09-25, board 3).
 * One station is open at a time; the rest are one line each with move and
 * remove. There is no save button: every change is sent after a short pause
 * (`useStationAutosave`), and a removal can be taken back for a few seconds.
 * A new station goes in where it belongs — between two, or at the end — and
 * starts where the one before it left off.
 */
export default function StationEditor({
  routeId,
  stations,
  legs,
  tripId,
  start,
  today,
  onSaved,
  onStatus,
  onEditLeg,
}: {
  routeId: string;
  stations: RoadtripStation[];
  legs: TourLeg[];
  tripId: string | null;
  start: EditorStart;
  today: string;
  onSaved: (saved: SavedStations) => void;
  onStatus: (status: SaveStatus, flush: () => Promise<void>) => void;
  onEditLeg: (
    leg: TourLeg,
    from: { id: string; title: string },
    to: { id: string; title: string }
  ) => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const { drafts, status, change, flush } = useStationAutosave({
    routeId,
    initial: stations.map(toEditorStation),
    onSaved,
  });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ station: EditorStation; index: number } | null>(null);
  const lodgings = useLodgingLibrary(true);
  const started = useRef(false);

  useEffect(() => onStatus(status, flush), [status, onStatus, flush]);

  const insertAt = (index: number, seed?: Partial<EditorStation>): void => {
    const station: EditorStation = {
      ...stationAfter(drafts[index - 1] ?? null),
      ...seed,
      key: newStationKey(),
    };
    change((prev) => [...prev.slice(0, index), station, ...prev.slice(index)]);
    setOpenKey(station.key);
  };

  // `?station=neu` / `?station=heute`: the list and the "tonight" button
  // arrive here wanting a station open, once.
  useEffect(() => {
    if (started.current || start === "plain") return;
    started.current = true;
    insertAt(drafts.length, start === "today" ? { startDate: today } : undefined);
  }, []);

  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [removed]);

  const update = (key: string, patch: Partial<EditorStation>): void =>
    change((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const move = (index: number, delta: number): void =>
    change((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const remove = (index: number): void => {
    setRemoved({ station: drafts[index], index });
    if (drafts[index].key === openKey) setOpenKey(null);
    change((prev) => prev.filter((_, i) => i !== index));
  };

  const undo = (): void => {
    if (!removed) return;
    const { station, index } = removed;
    change((prev) => [...prev.slice(0, index), station, ...prev.slice(index)]);
    setRemoved(null);
  };

  const legBetween = (a: EditorStation, b: EditorStation): TourLeg | undefined =>
    a.id && b.id ? legs.find((l) => l.fromStopId === a.id && l.toStopId === b.id) : undefined;

  const name = (s: EditorStation): string => s.title.trim() || t("roadtrips:editor.unnamed");
  const warnings = stationWarnings(drafts);

  return (
    <div className="flex flex-col" style={{ gap: 8 }}>
      <p
        className="t-caption"
        style={{
          padding: "12px 16px",
          borderRadius: "var(--ts-radius-button)",
          background: "var(--domain-roadtrip-soft)",
        }}
      >
        {t("roadtrips:editor.hint")}
      </p>

      {drafts.map((s, index) => {
        const next = drafts[index + 1];
        const leg = next ? legBetween(s, next) : undefined;
        return (
          <div key={s.key} className="flex flex-col" style={{ gap: 8 }}>
            {s.key === openKey ? (
              <StationEditCard
                station={s}
                position={index + 1}
                total={drafts.length}
                tripId={tripId}
                lodgings={lodgings}
                onChange={(patch) => update(s.key, patch)}
                onClose={() => setOpenKey(null)}
              />
            ) : (
              <div
                className="flex items-center"
                style={{
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: "var(--ts-radius-button)",
                  background: "var(--ts-surface)",
                  border: "1px solid var(--ts-border)",
                }}
              >
                <StationMarker state={s.night.kind} size="sm" cancelled={s.stayCancelled} />
                <button
                  type="button"
                  onClick={() => setOpenKey(s.key)}
                  className="flex min-w-0 flex-1 flex-wrap items-baseline text-left"
                  style={{
                    gap: 8,
                    background: "none",
                    border: 0,
                    padding: 0,
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontWeight: 800 }}>{name(s)}</span>
                  <span className="t-caption">
                    {[
                      t(`roadtrips:editor.choice.${s.night.kind}.label`),
                      s.stayLabel,
                      s.startDate?.slice(0, 10),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
                <IconButton
                  label={t("roadtrips:stations.moveUp")}
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                >
                  <Icon name="chevron-up" size={16} />
                </IconButton>
                <IconButton
                  label={t("roadtrips:stations.moveDown")}
                  onClick={() => move(index, 1)}
                  disabled={index === drafts.length - 1}
                >
                  <Icon name="chevron-down" size={16} />
                </IconButton>
                <IconButton label={t("roadtrips:stations.remove")} onClick={() => remove(index)}>
                  <Icon name="x" size={16} />
                </IconButton>
              </div>
            )}
            {leg && next && (
              <button
                type="button"
                onClick={() =>
                  onEditLeg(
                    leg,
                    { id: s.id as string, title: name(s) },
                    { id: next.id as string, title: name(next) }
                  )
                }
                className="flex items-center self-start"
                style={{
                  ...DASHED,
                  gap: 10,
                  padding: "0 14px",
                  borderColor: "var(--ts-border-button)",
                  color: "var(--ts-muted)",
                }}
              >
                {t(`roadtrips:timeline.leg.${leg.mode}`)} · {Math.round(leg.distanceKm)} km —{" "}
                {t("roadtrips:timeline.legEdit")}
              </button>
            )}
            {next && (
              <button type="button" onClick={() => insertAt(index + 1)} style={DASHED}>
                + {t("roadtrips:editor.insertBetween", { a: name(s), b: name(next) })}
              </button>
            )}
          </div>
        );
      })}

      <button type="button" onClick={() => insertAt(drafts.length)} style={DASHED}>
        + {t("roadtrips:editor.insertEnd")}
      </button>

      {warnings.length > 0 && (
        <div
          className="flex flex-col"
          style={{
            gap: 6,
            marginTop: 8,
            padding: 14,
            borderRadius: "var(--ts-radius-card)",
            background: "var(--ts-surface)",
            border: "1px solid var(--ts-border)",
          }}
        >
          <span className="t-label-mono">{t("roadtrips:editor.warningsTitle")}</span>
          {warnings.map((w) => (
            <button
              key={`${w.kind}-${w.index}`}
              type="button"
              onClick={() => setOpenKey(drafts[w.index].key)}
              className="flex items-center text-left"
              style={{
                gap: 8,
                fontSize: 13,
                color: "var(--ts-warn)",
                background: "none",
                border: 0,
                padding: 0,
                cursor: "pointer",
              }}
            >
              <Icon name="triangle-alert" size={14} />
              {t(`roadtrips:editor.warnings.${w.kind}`, { name: name(drafts[w.index]) })}
            </button>
          ))}
          <span className="t-caption">{t("roadtrips:editor.warningsNote")}</span>
        </div>
      )}

      {removed && (
        <div
          role="status"
          className="fixed flex items-center"
          style={{
            left: "50%",
            bottom: 28,
            transform: "translateX(-50%)",
            zIndex: 60,
            gap: 14,
            padding: "12px 16px",
            borderRadius: 14,
            background: "var(--ts-surface2)",
            border: "1px solid var(--ts-border-input)",
            boxShadow: "var(--ts-shadow-dialog)",
            fontSize: 14,
          }}
        >
          {t("roadtrips:editor.removed", { name: name(removed.station) })}
          <Button variant="secondary" icon={<Icon name="undo-2" size={16} />} onClick={undo}>
            {t("roadtrips:editor.undo")}
          </Button>
        </div>
      )}
    </div>
  );
}
