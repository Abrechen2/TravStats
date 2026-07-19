import { PortPicker } from "./PortPicker";
import type { CruiseStopInput, Port } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

// Stop arrival/departure are PORT-LOCAL wall-clock times — a ship arrives at
// "08:00" in the port's own time, independent of the viewer's timezone. Treat
// the datetime-local value as timezone-neutral and pin it to a literal UTC
// instant. Using `new Date(value).toISOString()` instead shifted the time by
// the browser's UTC offset on every save (display sliced the UTC ISO straight
// back), so a stored "08:00" reappeared as "06:00" and could roll to the
// previous day — the same asymmetry that dropped cruise start/end dates.
const fromStopInput = (local: string): string | null => (local ? `${local}:00.000Z` : null);

// Stop date is date-granular (the calendar day of the call). Pin to UTC
// midnight so the round-trip stays timezone-neutral, same as the cruise
// start/end dates — see CruiseEditModal for the rationale.
const fromDateInput = (date: string): string | null => (date ? `${date}T00:00:00.000Z` : null);

interface Props {
  stops: CruiseStopInput[];
  onChange: (stops: CruiseStopInput[]) => void;
}

/**
 * Stops editor for a cruise itinerary.
 *
 * Renders a vertical list of stops with:
 * - Move-up / move-down / remove controls.
 * - An "at sea" toggle (disables the port picker and clears `portId`).
 * - A `PortPicker` for the selected port (only when not at sea).
 * - Arrival / departure datetime-local inputs (only when not at sea).
 * - An excursion note textarea.
 *
 * After any mutation the editor re-emits the full list with `dayNumber`
 * renumbered to `index + 1` so the numbering always stays consecutive.
 */
export function CruiseStopsEditor({ stops, onChange }: Props): JSX.Element {
  const { t } = useTranslation("cruise");

  const renumber = (list: CruiseStopInput[]): CruiseStopInput[] =>
    list.map((s, idx) => ({ ...s, dayNumber: idx + 1 }));

  const update = (index: number, patch: Partial<CruiseStopInput>): void => {
    const next = stops.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(renumber(next));
  };

  const remove = (index: number): void => {
    onChange(renumber(stops.filter((_, i) => i !== index)));
  };

  const move = (index: number, delta: -1 | 1): void => {
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    const next = [...stops];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(renumber(next));
  };

  const add = (): void => {
    onChange(renumber([...stops, { portId: null, dayNumber: stops.length + 1, isAtSea: false }]));
  };

  const handlePortChange = (index: number, port: Port): void => {
    update(index, { portId: port.id, port, unresolvedPortName: null });
  };

  return (
    <div className="space-y-3">
      {stops.map((stop, i) => (
        <div
          key={i}
          className="rounded-md border border-border bg-(--bg-surface) p-3"
        >
          <div className="mb-2 flex items-center justify-between text-xs text-(--text-muted)">
            <span>
              {t("stops.day")} {stop.dayNumber}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={(): void => move(i, -1)}
                disabled={i === 0}
                aria-label={t("stops.moveUp")}
                title={t("stops.moveUp")}
                className="px-1 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={(): void => move(i, 1)}
                disabled={i === stops.length - 1}
                aria-label={t("stops.moveDown")}
                title={t("stops.moveDown")}
                className="px-1 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={(): void => remove(i)}
                className="px-1 text-(--danger) hover:text-(--danger)"
                aria-label={t("stops.remove")}
                title={t("stops.remove")}
              >
                ×
              </button>
            </div>
          </div>
          <input
            type="date"
            value={stop.date?.slice(0, 10) ?? ""}
            onChange={(e): void => update(i, { date: fromDateInput(e.target.value) })}
            style={{ colorScheme: "dark" }}
            className="mb-2 w-full rounded-md border border-border bg-(--bg-elevated) px-2 py-1 text-xs text-(--text-primary)"
            aria-label={t("stops.date")}
          />
          <label className="mb-2 flex items-center gap-2 text-xs text-(--text-muted)">
            <input
              type="checkbox"
              checked={stop.isAtSea}
              onChange={(e): void =>
                update(i, {
                  isAtSea: e.target.checked,
                  portId: e.target.checked ? null : stop.portId,
                  unresolvedPortName: e.target.checked ? null : stop.unresolvedPortName,
                })
              }
            />
            {t("stops.at_sea")}
          </label>
          {!stop.isAtSea && (
            <>
              {stop.portId == null && stop.unresolvedPortName ? (
                <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
                  <span className="font-medium">🔶 {t("stops.unresolved")}:</span>{" "}
                  {stop.unresolvedPortName}
                  <div className="mt-0.5 text-[11px] text-amber-300/80">
                    {t("stops.unresolvedHint")}
                  </div>
                </div>
              ) : null}
              <PortPicker
                value={stop.port ?? null}
                onChange={(p): void => handlePortChange(i, p)}
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="datetime-local"
                  value={stop.arrivalTime?.slice(0, 16) ?? ""}
                  onChange={(e): void =>
                    update(i, {
                      arrivalTime: fromStopInput(e.target.value),
                    })
                  }
                  className="rounded-md border border-border bg-(--bg-elevated) px-2 py-1 text-xs text-(--text-primary)"
                  aria-label={t("field.arrive")}
                />
                <input
                  type="datetime-local"
                  value={stop.departureTime?.slice(0, 16) ?? ""}
                  onChange={(e): void =>
                    update(i, {
                      departureTime: fromStopInput(e.target.value),
                    })
                  }
                  className="rounded-md border border-border bg-(--bg-elevated) px-2 py-1 text-xs text-(--text-primary)"
                  aria-label={t("field.depart")}
                />
              </div>
              <textarea
                value={stop.excursionNote ?? ""}
                onChange={(e): void => update(i, { excursionNote: e.target.value })}
                rows={2}
                className="mt-2 w-full rounded-md border border-border bg-(--bg-elevated) px-2 py-1 text-xs text-(--text-primary)"
                placeholder={t("stops.excursion")}
              />
            </>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="w-full rounded-md border border-dashed border-border py-2 text-xs text-(--text-muted) hover:border-(--accent) hover:text-(--accent)"
      >
        + {t("stops.add")}
      </button>
    </div>
  );
}
