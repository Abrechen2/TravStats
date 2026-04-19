import { PortPicker } from "./PortPicker";
import type { CruiseStopInput, Port } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

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
    update(index, { portId: port.id });
  };

  return (
    <div className="space-y-3">
      {stops.map((stop, i) => (
        <div key={i} className="rounded-md border border-neutral-700 bg-neutral-900 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-neutral-400">
            <span>
              {t("stops.day")} {stop.dayNumber}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={(): void => move(i, -1)}
                disabled={i === 0}
                aria-label="move up"
                className="px-1 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={(): void => move(i, 1)}
                disabled={i === stops.length - 1}
                aria-label="move down"
                className="px-1 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={(): void => remove(i)}
                className="px-1 text-red-400 hover:text-red-300"
                aria-label="remove"
              >
                ×
              </button>
            </div>
          </div>
          <label className="mb-2 flex items-center gap-2 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={stop.isAtSea}
              onChange={(e): void =>
                update(i, {
                  isAtSea: e.target.checked,
                  portId: e.target.checked ? null : stop.portId,
                })
              }
            />
            {t("stops.at_sea")}
          </label>
          {!stop.isAtSea && (
            <>
              <PortPicker value={null} onChange={(p): void => handlePortChange(i, p)} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="datetime-local"
                  value={stop.arrivalTime?.slice(0, 16) ?? ""}
                  onChange={(e): void =>
                    update(i, {
                      arrivalTime: e.target.value ? new Date(e.target.value).toISOString() : null,
                    })
                  }
                  className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
                  aria-label={t("field.arrive")}
                />
                <input
                  type="datetime-local"
                  value={stop.departureTime?.slice(0, 16) ?? ""}
                  onChange={(e): void =>
                    update(i, {
                      departureTime: e.target.value ? new Date(e.target.value).toISOString() : null,
                    })
                  }
                  className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
                  aria-label={t("field.depart")}
                />
              </div>
              <textarea
                value={stop.excursionNote ?? ""}
                onChange={(e): void => update(i, { excursionNote: e.target.value })}
                rows={2}
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
                placeholder={t("stops.excursion")}
              />
            </>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="w-full rounded-md border border-dashed border-neutral-700 py-2 text-xs text-neutral-400 hover:border-sky-500 hover:text-sky-400"
      >
        + {t("stops.add")}
      </button>
    </div>
  );
}
