import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import type { CruiseStopInput } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { withCruiseDayNumbers } from "./cruiseDayNumbers";
import { newStopKey, stopKeyAt, withStopKeys } from "./cruiseStopKeys";
import { CruiseStopFields } from "./CruiseStopFields";
import { CruiseStopSummary } from "./CruiseStopSummary";
import { stopLacksPort } from "./cruiseFormDraft";

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
}

type FocusTarget = "up" | "down" | "summary";

// Labelled buttons with text, not "↑ ↓ ×" glyphs with a title: a glyph says
// nothing to a sighted touch user, and on an iPad there is no hover to read
// the title (forgejo#221, #249). 44 px on a coarse pointer.
const ACTION_CLASS =
  "rounded-md border border-border px-2 py-1 text-xs text-(--text-primary) hover:bg-(--bg-elevated) disabled:opacity-40 pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:px-3";

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
 * - After any change the list is re-emitted with each stop's `dayNumber`
 *   resolved by `withCruiseDayNumbers`: a stop keeps its day of the cruise, a
 *   new one takes the next free day (forgejo#126).
 */
export function CruiseStopsEditor({
  stops,
  onChange,
  idPrefix,
  missingHintId,
}: Props): JSX.Element {
  const { t } = useTranslation("cruise");
  const generatedId = useId();
  const prefix = idPrefix ?? `cruise-stops-${generatedId.replace(/:/g, "")}`;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const pendingFocus = useRef<{
    key: string;
    target: FocusTarget;
    from: CruiseStopInput[];
  } | null>(null);

  const idFor = (key: string, part: string): string => `${prefix}-${key}-${part}`;

  // Focus follows the moved stop AFTER the list re-rendered in its new order
  // — that is, once the parent has handed back a NEW stops array; the request
  // is answered (or dropped) on that render and never lingers to steal focus
  // later. A move button that became disabled (the stop reached an end) hands
  // focus to its partner, so the keyboard never drops to <body>.
  useEffect(() => {
    const request = pendingFocus.current;
    if (request === null || request.from === stops) return;
    pendingFocus.current = null;
    const order: FocusTarget[] =
      request.target === "summary"
        ? ["summary"]
        : [request.target, request.target === "up" ? "down" : "up", "summary"];
    for (const target of order) {
      const element = document.getElementById(`${prefix}-${request.key}-${target}`);
      if (element instanceof HTMLButtonElement && element.disabled) continue;
      if (element) {
        element.focus();
        return;
      }
    }
  });

  const emit = (next: CruiseStopInput[]): void => onChange(withCruiseDayNumbers(next));

  const update = (index: number, patch: Partial<CruiseStopInput>): void => {
    emit(withStopKeys(stops).map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const remove = (index: number): void => {
    const keyed = withStopKeys(stops);
    const key = keyed[index].uiKey;
    const next = keyed.filter((_, i) => i !== index);
    if (key === openKey) setOpenKey(null);
    // Focus lands on the day that took this one's place (or the one before).
    const neighbour = next[Math.min(index, next.length - 1)];
    if (neighbour?.uiKey)
      pendingFocus.current = { key: neighbour.uiKey, target: "summary", from: stops };
    emit(next);
  };

  const move = (index: number, delta: -1 | 1): void => {
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    const next = withStopKeys(stops);
    [next[index], next[target]] = [next[target], next[index]];
    pendingFocus.current = {
      key: next[target].uiKey as string,
      target: delta < 0 ? "up" : "down",
      from: stops,
    };
    emit(next);
  };

  const add = (): void => {
    const key = newStopKey();
    setOpenKey(key);
    pendingFocus.current = { key, target: "summary", from: stops };
    emit([
      ...withStopKeys(stops),
      { portId: null, dayNumber: 1, originalDay: null, isAtSea: false, uiKey: key },
    ]);
  };

  return (
    <div className="flex flex-col gap-2">
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
                  <div
                    role="group"
                    aria-label={t("stops.actionsLabel", { day: stop.dayNumber })}
                    className="mb-3 flex flex-wrap gap-2"
                  >
                    <button
                      id={idFor(key, "up")}
                      type="button"
                      onClick={(): void => move(i, -1)}
                      disabled={i === 0}
                      className={ACTION_CLASS}
                    >
                      <span aria-hidden="true">↑ </span>
                      {t("stops.moveUp")}
                    </button>
                    <button
                      id={idFor(key, "down")}
                      type="button"
                      onClick={(): void => move(i, 1)}
                      disabled={i === stops.length - 1}
                      className={ACTION_CLASS}
                    >
                      <span aria-hidden="true">↓ </span>
                      {t("stops.moveDown")}
                    </button>
                    <button
                      id={idFor(key, "remove")}
                      type="button"
                      onClick={(): void => remove(i)}
                      className={`${ACTION_CLASS} text-(--danger)`}
                    >
                      {t("stops.remove")}
                    </button>
                  </div>
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
        type="button"
        onClick={add}
        className="w-full rounded-md border border-dashed border-border py-2 text-xs text-(--text-muted) hover:border-(--accent) hover:text-(--accent) pointer-coarse:min-h-(--ts-size-touch-min)"
      >
        + {t("stops.add")}
      </button>
    </div>
  );
}
