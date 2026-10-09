import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";

import IconButton from "../ui/IconButton";
import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { logger } from "../../lib/logger";
import { stationAfter, stationWarnings } from "../../lib/roadtrip/roadtripView";
import {
  clearStationDraft,
  writeStationDraft,
  type StoredStationDraft,
} from "../../lib/roadtrip/stationDraftStore";
import { mergeStations, type StationMerge } from "../../lib/roadtrip/stationMerge";
import type { RoadtripStation } from "../../types/roadtrip";
import type { TourLeg } from "../../types/tour";
import {
  isProtectedSource,
  moveStation,
  reorderImpact,
  type ReorderImpact,
} from "../../lib/roadtrip/reorderImpact";
import type { ShiftRow } from "../../lib/roadtrip/shiftDays";
import ReorderPreviewDialog from "./ReorderPreviewDialog";
import ShiftDaysDialog from "./ShiftDaysDialog";
import StationConflictDialog from "./StationConflictDialog";
import { FormErrorBanner } from "../form";
import { isTransientSaveError } from "../../lib/saveErrorMessage";
import UndoBar from "./UndoBar";
import StationEditCard from "./StationEditCard";
import StationMarker from "./StationMarker";
import { useLodgingLibrary } from "./StayPicker";
import {
  HOLD_MS,
  newStationKey,
  toEditorStation,
  useStationAutosave,
  type EditorStation,
  type LocalDraftState,
  type SaveStatus,
  type SavedStations,
  type StationDraftSink,
} from "./useStationAutosave";

const DASHED: CSSProperties = {
  // 44 px: these are tapped on an iPad more than anywhere (forgejo#249).
  minHeight: "var(--ts-size-touch-min)",
  borderRadius: "var(--ts-radius-button)",
  background: "none",
  border: "1px dashed color-mix(in srgb, var(--domain-roadtrip) 50%, transparent)",
  color: "var(--domain-roadtrip)",
  fontSize: 13,
  cursor: "pointer",
};

/** How the editor opens: plainly, with a new station, or with tonight's. */
export type EditorStart = "plain" | "new" | "today";

/** What the page's header shows about the editor, and the actions it offers. */
export interface EditorSaveState {
  status: SaveStatus;
  local: LocalDraftState;
  flush: () => Promise<SaveStatus>;
  discard: () => void;
  merge: () => void;
}

/** A merge waiting for the reader: from a restored draft, or a refused save. */
interface PendingMerge {
  origin: "restore" | "live";
  merge: StationMerge;
  server: EditorStation[];
}

/**
 * The stations of a roadtrip, edited in place (design 2026-09-25, board 3).
 * One station is open at a time; the rest are one line each with move and
 * remove. There is no save button: every change is sent after a short pause
 * (`useStationAutosave`), and a removal can be taken back for a few seconds.
 * A new station goes in where it belongs — between two, or at the end — and
 * starts where the one before it left off.
 *
 * forgejo#244: unsent edits are kept in this browser too (`stationDraftStore`,
 * keyed by user and roadtrip), so a dropped connection or a closed tab does not
 * lose them; `restore` continues from such a draft. Before a draft goes over a
 * server state that moved on — or when a save meets a list the phone changed —
 * `StationConflictDialog` asks per field.
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
  userId = null,
  restore = null,
}: {
  routeId: string;
  stations: RoadtripStation[];
  legs: TourLeg[];
  tripId: string | null;
  start: EditorStart;
  today: string;
  onSaved: (saved: SavedStations) => void;
  onStatus: (state: EditorSaveState) => void;
  /** Whose local draft this is; without one, nothing is kept locally. */
  userId?: string | null;
  /** A local draft from an earlier visit the reader chose to restore. */
  restore?: StoredStationDraft | null;
  onEditLeg: (
    leg: TourLeg,
    from: { id: string; title: string },
    to: { id: string; title: string }
  ) => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const display = useDisplayFormat();
  const sink = useMemo<StationDraftSink | null>(
    () =>
      userId
        ? {
            write: (draft) => writeStationDraft(userId, routeId, draft),
            clear: () => clearStationDraft(userId, routeId),
          }
        : null,
    [userId, routeId]
  );
  // A restored draft whose server side did not move on goes straight back
  // into the editor; otherwise the reader decides per field first.
  const [opening] = useState(() => {
    const initial = stations.map(toEditorStation);
    if (!restore) return { initial, restored: null, merge: null };
    const merge = mergeStations(restore.base, restore.drafts, initial);
    const quiet =
      merge.conflicts.length === 0 &&
      merge.addedThere.length === 0 &&
      merge.removedThere.length === 0;
    return {
      initial,
      restored: quiet ? merge.resolve() : null,
      merge: quiet ? null : merge,
    };
  });
  const {
    drafts,
    status,
    local,
    errorKey,
    serverStations,
    change,
    releaseHold,
    flush,
    rebase,
    discard,
  } = useStationAutosave({
    routeId,
    initial: opening.initial,
    restored: opening.restored,
    onSaved,
    sink,
  });
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(() =>
    opening.merge ? { origin: "restore", merge: opening.merge, server: opening.initial } : null
  );
  const [mergeFailed, setMergeFailed] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** The one step "Rückgängig" takes back — a removal or a reorder (forgejo#242). */
  const [undoable, setUndoable] = useState<{
    label: string;
    restores?: string;
    restore: () => void;
  } | null>(null);
  const [reorder, setReorder] = useState<{
    from: number;
    to: number;
    impact: ReorderImpact;
  } | null>(null);
  const [shiftFrom, setShiftFrom] = useState<number | null>(null);
  const lodgings = useLodgingLibrary(true);
  const started = useRef(false);

  /**
   * A save the server refused because the phone changed the list: read what
   * the server holds now and ask how to merge. A failed read says so and
   * leaves the edits where they are (kept locally).
   */
  const openMerge = useCallback(async (): Promise<void> => {
    setMergeFailed(false);
    try {
      const fresh = await roadtripsApi.get(routeId);
      const server = fresh.stations.map(toEditorStation);
      setPendingMerge({
        origin: "live",
        merge: mergeStations(serverStations(), drafts, server),
        server,
      });
    } catch (err) {
      logger.warn("Reading the roadtrip for a merge failed", err);
      setMergeFailed(true);
    }
  }, [routeId, serverStations, drafts]);

  const conflictSeen = useRef(false);
  useEffect(() => {
    if (status !== "conflict") {
      conflictSeen.current = false;
      return;
    }
    if (conflictSeen.current) return;
    conflictSeen.current = true;
    void openMerge();
  }, [status, openMerge]);

  useEffect(
    () => onStatus({ status, local, flush, discard, merge: () => void openMerge() }),
    [status, local, onStatus, flush, discard, openMerge]
  );

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

  // The undo window is the hold's: when it closes, the held change goes out.
  useEffect(() => {
    if (!undoable) return;
    const timer = setTimeout(() => setUndoable(null), HOLD_MS);
    return () => clearTimeout(timer);
  }, [undoable]);

  const update = (key: string, patch: Partial<EditorStation>): void =>
    change((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  /**
   * forgejo#242: a move is asked first — new neighbours, the legs that go and
   * come, the dates that would read backwards — and then held for the undo
   * window, so "Rückgängig" restores the legs as well as the order.
   */
  const askMove = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= drafts.length) return;
    setReorder({ from: index, to: target, impact: reorderImpact(drafts, legs, index, target) });
  };

  const confirmMove = (): void => {
    if (!reorder) return;
    const { from, to, impact } = reorder;
    const key = impact.moved.key;
    setReorder(null);
    change((prev) => moveStation(prev, from, to), { hold: true });
    setUndoable({
      label: t("roadtrips:editor.moved", { name: name(impact.moved) }),
      restores: t("roadtrips:editor.movedRestores"),
      restore: () =>
        change((prev) => {
          const at = prev.findIndex((s) => s.key === key);
          return at < 0 ? prev : moveStation(prev, at, Math.min(from, prev.length - 1));
        }),
    });
  };

  const remove = (index: number): void => {
    const station = drafts[index];
    if (station.key === openKey) setOpenKey(null);
    // Held like a move: the server drops the legs on both sides of it.
    change((prev) => prev.filter((_, i) => i !== index), { hold: true });
    setUndoable({
      label: t("roadtrips:editor.removed", { name: name(station) }),
      restore: () => change((prev) => [...prev.slice(0, index), station, ...prev.slice(index)]),
    });
  };

  /**
   * forgejo#241: the dates of every station from `fromIndex` on, moved after
   * the preview. The undo takes back exactly those dates — not the whole list,
   * so an edit made since stays — and says which ones it restores.
   */
  const applyShift = (
    fromIndex: number,
    shifted: EditorStation[],
    rows: ShiftRow[],
    days: number
  ): void => {
    const previous = new Map(
      drafts.slice(fromIndex).map((s) => [s.key, { startDate: s.startDate, endDate: s.endDate }])
    );
    const moved = new Set(rows.map((r) => r.station.key));
    const byKey = new Map(shifted.map((s) => [s.key, s]));
    setShiftFrom(null);
    change((prev) =>
      prev.map((s) => {
        const next = moved.has(s.key) ? byKey.get(s.key) : undefined;
        return next ? { ...s, startDate: next.startDate, endDate: next.endDate } : s;
      })
    );
    const first = rows[0];
    const last = rows[rows.length - 1];
    setUndoable({
      label: t("roadtrips:shift.done", {
        count: rows.length,
        days: days > 0 ? `+${days}` : String(days),
      }),
      restores: t("roadtrips:shift.undoRestores", {
        count: rows.length,
        from: dayLabel(first?.before.start ?? null),
        to: dayLabel(last?.before.end ?? last?.before.start ?? null),
      }),
      restore: () =>
        change((prev) =>
          prev.map((s) => {
            const old = moved.has(s.key) ? previous.get(s.key) : undefined;
            return old ? { ...s, ...old } : s;
          })
        ),
    });
  };

  const undo = (): void => {
    if (!undoable) return;
    undoable.restore();
    releaseHold();
    setUndoable(null);
  };

  const legBetween = (a: EditorStation, b: EditorStation): TourLeg | undefined =>
    a.id && b.id ? legs.find((l) => l.fromStopId === a.id && l.toStopId === b.id) : undefined;

  const dayLabel = (day: string | null): string =>
    day ? display.date(`${day}T00:00:00Z`, { timeZone: "UTC", omitYear: true }) : "—";
  const name = (s: EditorStation): string =>
    s.title.trim() ||
    (s.night.kind === "via" ? t("roadtrips:night.via") : t("roadtrips:editor.unnamed"));
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

      {/* Why the last save failed, said where the editing happens and kept
          until the next save (forgejo#246/#247) — not only as two words in the
          page header. The edits stay; a retry is offered where it can help. */}
      {status === "error" && (
        <FormErrorBanner
          message={t(errorKey ?? "roadtrips:editor.saveFailed")}
          onRetry={!errorKey || isTransientSaveError(errorKey) ? () => void flush() : undefined}
        />
      )}

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
                onShift={() => setShiftFrom(index)}
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
                      // A station day is a calendar day: shown in the user's
                      // date format, read in UTC so it does not shift.
                      s.startDate &&
                        display.date(`${s.startDate.slice(0, 10)}T00:00:00Z`, { timeZone: "UTC" }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
                <IconButton
                  label={t("roadtrips:stations.moveUp")}
                  onClick={() => askMove(index, -1)}
                  disabled={index === 0}
                >
                  <Icon name="chevron-up" size={16} />
                </IconButton>
                <IconButton
                  label={t("roadtrips:stations.moveDown")}
                  onClick={() => askMove(index, 1)}
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
                {t(`roadtrips:timeline.leg.${leg.mode}`)} · {Math.round(leg.distanceKm)} km ·{" "}
                {/* What the line is made of, said in the editor too (forgejo#242):
                    a recorded or hand-drawn leg is one a reorder can cost. */}
                <span
                  style={{
                    color: isProtectedSource(leg.source) ? "var(--ts-warn)" : undefined,
                  }}
                >
                  {t(`roadtrips:timeline.source.${leg.source}`)}
                </span>{" "}
                — {t("roadtrips:timeline.legEdit")}
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
              className="flex items-center text-left pointer-coarse:min-h-(--ts-size-touch-min)"
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

      {mergeFailed && (
        <p role="alert" style={{ fontSize: 13, color: "var(--ts-bad)" }}>
          {t("roadtrips:conflict.readFailed")}
        </p>
      )}

      {pendingMerge && (
        <StationConflictDialog
          merge={pendingMerge.merge}
          origin={pendingMerge.origin}
          onClose={() => setPendingMerge(null)}
          onApply={(merged) => {
            rebase(pendingMerge.server, merged);
            setPendingMerge(null);
          }}
        />
      )}

      {reorder && (
        <ReorderPreviewDialog
          impact={reorder.impact}
          onConfirm={confirmMove}
          onClose={() => setReorder(null)}
        />
      )}

      {shiftFrom !== null && drafts[shiftFrom] && (
        <ShiftDaysDialog
          routeId={routeId}
          tripId={tripId}
          drafts={drafts}
          fromIndex={shiftFrom}
          lodgings={lodgings}
          onClose={() => setShiftFrom(null)}
          onApply={(shifted, rows, days) => applyShift(shiftFrom, shifted, rows, days)}
        />
      )}

      {undoable && <UndoBar label={undoable.label} restores={undoable.restores} onUndo={undo} />}
    </div>
  );
}
