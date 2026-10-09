import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import type { CruiseStopInput } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { withCruiseDayNumbers } from "./cruiseDayNumbers";
import { newStopKey, stopKeyAt, withStopKeys } from "./cruiseStopKeys";
import { CruiseStopFields } from "./CruiseStopFields";
import { CruiseStopSummary, stopTitle } from "./CruiseStopSummary";
import { CruiseStopActions } from "./CruiseStopActions";
import { stopLacksPort } from "./cruiseFormDraft";
import { moveStop, removeStop, undoSequenceOp } from "./cruiseStopSequence";
import type { SequenceOp } from "./cruiseStopSequence";

interface Props {
  stops: CruiseStopInput[];
  onChange: (stops: CruiseStopInput[]) => void;
  /** Prefix for the ids of the controls; defaults to one unique per editor. */
  idPrefix?: string;
  /**
   * The form's "still needed" hint: a day without a port and not at sea is
   * refused by the server, and its port field points at the line that says so.
   */
  missingHintId?: string;
  /** The cruise's start date ("YYYY-MM-DD"), so a reorder can preview derived dates. */
  startDate?: string;
}

/** A sequence edit that can be taken back, and how to name it. */
interface HistoryEntry {
  op: SequenceOp;
  label: string;
}

const UNDO_DEPTH = 20;

/**
 * The itinerary editor (forgejo#221): a compact list of days first — one line
 * each, "Tag 3 · 12.10. · Barcelona · 08:00–18:00" — and only the day the user
 * opens unfolds into its fields. A 14-night cruise used to render fourteen
 * full forms, each with five fields and three glyph buttons, which on an iPad
 * was a page of scrolling to reach the stop one came for.
 *
 * - **One open day.** Each day is a `<details>`; opening one closes the one
 *   before. A native `<details>` on purpose: the shared "still needed" hint and
 *   the first-error focus unfold the enclosing `<details>` themselves
 *   (`unfoldAncestors`), so a missing port in a folded day stays reachable.
 * - **Reordering keeps its place.** The open day and the focus follow the
 *   moved STOP, not the position it left: a keyboard user who presses "Nach
 *   oben" three times keeps moving the same port. Stops carry a UI-only key
 *   for that (`uiKey`, stripped on submit).
 * - **A reorder says what it does, and can be taken back** (forgejo#224): the
 *   opened day previews which days a move renumbers or re-dates, a removal
 *   asks once more naming the date, times and note that go, and "Hafenfolge
 *   rückgängig" takes back the last move, removal or added day — a different
 *   button from the route map's own undo, which edits the drawn line.
 * - After any change the list is re-emitted with each stop's `dayNumber`
 *   resolved by `withCruiseDayNumbers`: a stop keeps its day of the cruise, a
 *   new one takes the next free day (forgejo#126).
 */
export function CruiseStopsEditor({
  stops,
  onChange,
  idPrefix,
  missingHintId,
  startDate = "",
}: Props): JSX.Element {
  const { t } = useTranslation("cruise");
  const generatedId = useId();
  const prefix = idPrefix ?? `cruise-stops-${generatedId.replace(/:/g, "")}`;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  /** What the last undo took back — said once, in the status line. */
  const [undone, setUndone] = useState<string | null>(null);
  const pendingFocus = useRef<{ ids: string[]; from: CruiseStopInput[] } | null>(null);

  const idFor = (key: string, part: string): string => `${prefix}-${key}-${part}`;
  const addId = `${prefix}-add`;
  const undoId = `${prefix}-undo`;

  // Focus follows the moved stop AFTER the list re-rendered in its new order
  // — that is, once the parent has handed back a NEW stops array; the request
  // is answered (or dropped) on that render and never lingers to steal focus
  // later. A move button that became disabled (the stop reached an end) hands
  // focus to its partner, so the keyboard never drops to <body>.
  useEffect(() => {
    const request = pendingFocus.current;
    if (request === null || request.from === stops) return;
    pendingFocus.current = null;
    for (const id of request.ids) {
      const element = document.getElementById(id);
      if (element instanceof HTMLButtonElement && element.disabled) continue;
      if (element) {
        element.focus();
        return;
      }
    }
  });

  const emit = (next: CruiseStopInput[]): void => onChange(withCruiseDayNumbers(next));

  const record = (op: SequenceOp, label: string): void => {
    setHistory((prev) => [...prev, { op, label }].slice(-UNDO_DEPTH));
    setUndone(null);
  };

  const update = (index: number, patch: Partial<CruiseStopInput>): void => {
    emit(withStopKeys(stops).map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const remove = (index: number): void => {
    const keyed = withStopKeys(stops);
    const { next, op } = removeStop(keyed, index);
    const gone = keyed[index];
    if (gone.uiKey === openKey) setOpenKey(null);
    // Focus lands on the day that took this one's place (or the one before),
    // else on "add" when the list is empty now.
    const neighbour = next[Math.min(index, next.length - 1)];
    pendingFocus.current = {
      ids: neighbour?.uiKey ? [idFor(neighbour.uiKey, "summary")] : [addId],
      from: stops,
    };
    record(op, t("stops.undo.removed", { title: stopTitle(gone, t), day: gone.dayNumber }));
    emit(next);
  };

  const move = (index: number, delta: -1 | 1): void => {
    const keyed = withStopKeys(stops);
    const moved = moveStop(keyed, index, delta);
    if (moved === null) return;
    const key = moved.next[index + delta].uiKey as string;
    const [first, second] = delta < 0 ? ["up", "down"] : ["down", "up"];
    pendingFocus.current = {
      ids: [idFor(key, first), idFor(key, second), idFor(key, "summary")],
      from: stops,
    };
    record(moved.op, t("stops.undo.moved", { title: stopTitle(keyed[index], t) }));
    emit(moved.next);
  };

  const add = (): void => {
    const key = newStopKey();
    const keyed = withStopKeys(stops);
    setOpenKey(key);
    pendingFocus.current = { ids: [idFor(key, "summary")], from: stops };
    const next = withCruiseDayNumbers([
      ...keyed,
      { portId: null, dayNumber: 1, originalDay: null, isAtSea: false, uiKey: key },
    ]);
    record({ kind: "add", key }, t("stops.undo.added", { day: next[next.length - 1].dayNumber }));
    onChange(next);
  };

  const undo = (): void => {
    const last = history[history.length - 1];
    if (!last) return;
    const restored = undoSequenceOp(withStopKeys(stops), last.op);
    setHistory((prev) => prev.slice(0, -1));
    setUndone(last.label);
    const key =
      last.op.kind === "remove" ? last.op.stop.uiKey : last.op.kind === "move" ? last.op.key : null;
    if (key) {
      setOpenKey(key);
      pendingFocus.current = { ids: [idFor(key, "summary")], from: stops };
    } else {
      pendingFocus.current = { ids: [undoId, addId], from: stops };
    }
    emit(restored);
  };

  const keyed = withStopKeys(stops);
  const last = history[history.length - 1];

  return (
    <div className="flex flex-col gap-2">
      {/* Said in a live region, so a screen reader hears what the last
          reorder was and what an undo took back. */}
      <div role="status" className="text-xs text-(--text-muted)">
        {last ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>{t("stops.undo.last", { action: last.label })}</span>
            <button
              id={undoId}
              type="button"
              onClick={undo}
              aria-describedby={`${prefix}-undo-scope`}
              className="rounded-md border border-border px-2 py-1 text-xs text-(--text-primary) hover:bg-(--bg-elevated) pointer-coarse:min-h-(--ts-size-touch-min)"
            >
              <span aria-hidden="true">↶ </span>
              {t("stops.undo.button")}
            </button>
            <span id={`${prefix}-undo-scope`}>{t("stops.undo.scope")}</span>
          </div>
        ) : undone ? (
          <span>{t("stops.undo.done", { action: undone })}</span>
        ) : null}
      </div>
      <ol className="flex flex-col gap-1.5">
        {stops.map((stop, i) => {
          const key = stopKeyAt(stop, i);
          const open = key === openKey;
          return (
            <li key={key} className="rounded-md border border-border bg-(--bg-surface)">
              <details
                open={open}
                onToggle={(e): void => {
                  // Exclusive: opening a day closes the one before. Read from
                  // the element, so a programmatic unfold (the "still needed"
                  // hint) is followed too.
                  if (e.currentTarget.open) setOpenKey(key);
                  else if (open) setOpenKey(null);
                }}
              >
                <summary
                  id={idFor(key, "summary")}
                  className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
                >
                  <CruiseStopSummary stop={stop} open={open} />
                </summary>
                <div className="border-t border-border px-3 pt-2 pb-3">
                  {/* Rendered for the OPEN day only: its previews compute the
                      whole list's days, which a closed day needs nobody to see. */}
                  {open && (
                    <CruiseStopActions
                      stops={keyed}
                      index={i}
                      startDate={startDate}
                      idFor={(part): string => idFor(key, part)}
                      onMove={(delta): void => move(i, delta)}
                      onRemove={(): void => remove(i)}
                    />
                  )}
                  <CruiseStopFields
                    stop={stop}
                    idBase={`${prefix}-${key}`}
                    onPatch={(patch): void => update(i, patch)}
                    portDescribedBy={stopLacksPort(stop) ? missingHintId : undefined}
                  />
                </div>
              </details>
            </li>
          );
        })}
      </ol>
      <button
        id={addId}
        type="button"
        onClick={add}
        className="w-full rounded-md border border-dashed border-border py-2 text-xs text-(--text-muted) hover:border-(--accent) hover:text-(--accent) pointer-coarse:min-h-(--ts-size-touch-min)"
      >
        + {t("stops.add")}
      </button>
    </div>
  );
}
