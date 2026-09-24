import { useState } from "react";
import type { JSX } from "react";

import { LocationInput } from "../location/LocationInput";
import { useTranslation } from "../../hooks/useTranslation";
import type { StationNightInput, StationInput } from "../../types/roadtrip";
import StayPicker, { useLodgingLibrary, type PickableStay } from "./StayPicker";

/** A station while it is being edited: coordinates may still be missing. */
interface StationDraft extends Omit<StationInput, "lat" | "lon"> {
  lat: number | null;
  lon: number | null;
  /** The linked stay's display name, for a stay picked in this session. */
  stayLabel?: string;
}

function toDraft(input: StationInput, stayLabel?: string): StationDraft {
  return { ...input, stayLabel };
}

function isComplete(d: StationDraft): d is StationDraft & { lat: number; lon: number } {
  return d.title.trim() !== "" && d.lat !== null && d.lon !== null;
}

/** `YYYY-MM-DD` for a date input from whatever the API returned. */
function dayInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

const NIGHT_KINDS: StationNightInput["kind"][] = ["stay", "free", "pass"];

/**
 * The station list of one roadtrip, edited as a whole and saved in one write
 * (the endpoint replaces the list atomically, so the editor does too).
 *
 * Each station's night is one of three things and the control says so — a
 * segmented choice, not a checkbox plus an optional field, because "a night
 * at a stay" without a stay is a state the server refuses and the form should
 * not be able to express either.
 */
export default function StationEditor({
  initial,
  initialStayLabels,
  tripId,
  saving,
  onSave,
  onCancel,
}: {
  initial: StationInput[];
  /** Stay names for the stations as loaded, keyed by station id. */
  initialStayLabels: Record<string, string>;
  tripId: string | null;
  saving: boolean;
  onSave: (stations: StationInput[]) => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  const [draft, setDraft] = useState<StationDraft[]>(() =>
    initial.map((s) => toDraft(s, s.id ? initialStayLabels[s.id] : undefined))
  );
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const lodgings = useLodgingLibrary(pickerFor !== null);

  const update = (index: number, patch: Partial<StationDraft>): void =>
    setDraft((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    setDraft((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const setNightKind = (index: number, kind: StationNightInput["kind"]): void => {
    if (kind === "stay") {
      // A stay night needs a stay; open the picker rather than store a
      // half-state the server would refuse.
      setPickerFor(index);
      return;
    }
    update(index, { night: { kind }, stayLabel: undefined });
  };

  const pickStay = (index: number, stay: PickableStay): void => {
    update(index, {
      night: { kind: "stay", lodgingStayId: stay.id },
      stayLabel: stay.label,
      startDate: draft[index].startDate || stay.checkIn,
      endDate: draft[index].endDate || stay.checkOut,
    });
    setPickerFor(null);
  };

  const incomplete = draft.some((s) => !isComplete(s));

  const save = (): void => {
    const complete = draft.filter(isComplete);
    if (complete.length !== draft.length) return;
    onSave(
      complete.map(({ stayLabel: _label, ...s }) => ({
        ...s,
        startDate: s.startDate || null,
        endDate: s.endDate || null,
      }))
    );
  };

  return (
    <div className="space-y-3">
      {draft.length === 0 && (
        <p className="text-sm text-(--text-muted)">{t("roadtrips:stations.empty")}</p>
      )}
      <ol className="space-y-3">
        {draft.map((station, index) => (
          <li
            key={station.id ?? `new-${index}`}
            className="space-y-2 rounded-lg border border-(--color-border) p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="t-meta-mono w-6 text-center">{index + 1}</span>
              <input
                id={`station-title-${index}`}
                type="text"
                value={station.title}
                onChange={(e) => update(index, { title: e.target.value })}
                placeholder={t("roadtrips:stations.titlePlaceholder")}
                aria-label={t("roadtrips:stations.titlePlaceholder")}
                className="min-w-40 flex-1 rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={t("roadtrips:stations.moveUp")}
                className="px-1 text-sm disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === draft.length - 1}
                aria-label={t("roadtrips:stations.moveDown")}
                className="px-1 text-sm disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
                className="text-xs underline"
              >
                {t("roadtrips:stations.remove")}
              </button>
            </div>

            <LocationInput
              compact
              idPrefix={`station-location-${index}`}
              value={
                station.lat !== null && station.lon !== null
                  ? { lat: station.lat, lon: station.lon }
                  : null
              }
              onChange={(sel) =>
                update(index, {
                  lat: sel.lat,
                  lon: sel.lon,
                  title: station.title.trim() === "" && sel.name ? sel.name : station.title,
                })
              }
            />

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1">
                <span className="text-xs text-(--text-muted)">{t("roadtrips:stations.from")}</span>
                <input
                  id={`station-start-${index}`}
                  type="date"
                  value={dayInput(station.startDate)}
                  onChange={(e) => update(index, { startDate: e.target.value || null })}
                  className="rounded-sm border border-(--color-border) bg-transparent px-2 py-1"
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-xs text-(--text-muted)">{t("roadtrips:stations.to")}</span>
                <input
                  id={`station-end-${index}`}
                  type="date"
                  value={dayInput(station.endDate)}
                  onChange={(e) => update(index, { endDate: e.target.value || null })}
                  className="rounded-sm border border-(--color-border) bg-transparent px-2 py-1"
                />
              </label>
            </div>

            <div
              role="radiogroup"
              aria-label={t("roadtrips:stations.nightLabel")}
              className="flex flex-wrap items-center gap-1"
            >
              {NIGHT_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={station.night.kind === kind}
                  onClick={() => setNightKind(index, kind)}
                  className="rounded-full border px-2.5 py-0.5 text-xs"
                  style={
                    station.night.kind === kind
                      ? {
                          borderColor: `var(--domain-${kind === "stay" ? "lodging" : "roadtrip"})`,
                          background: `var(--domain-${kind === "stay" ? "lodging" : "roadtrip"}-soft)`,
                        }
                      : { borderColor: "var(--color-border)" }
                  }
                >
                  {t(`roadtrips:night.${kind}`)}
                </button>
              ))}
              {station.night.kind === "stay" && (
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => setPickerFor(pickerFor === index ? null : index)}
                >
                  {station.stayLabel ?? t("roadtrips:stay.linked")} · {t("roadtrips:stay.change")}
                </button>
              )}
            </div>

            {pickerFor === index && (
              <StayPicker
                selectedStayId={station.night.kind === "stay" ? station.night.lodgingStayId : null}
                near={{ startDate: station.startDate ?? null, endDate: station.endDate ?? null }}
                place={{ name: station.title, lat: station.lat, lon: station.lon }}
                tripId={tripId}
                lodgings={lodgings}
                onPick={(stay) => pickStay(index, stay)}
              />
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setDraft((prev) => [
              ...prev,
              { title: "", lat: null, lon: null, night: { kind: "free" } },
            ])
          }
          className="rounded-sm border border-(--color-border) px-3 py-1.5 text-sm hover:bg-(--bg-surface)"
        >
          {t("roadtrips:stations.add")}
        </button>
        <button
          type="button"
          disabled={saving || incomplete}
          onClick={save}
          className="rounded-sm bg-(--accent) px-3 py-1.5 text-sm text-(--bg-base) disabled:opacity-40"
        >
          {t("roadtrips:stations.save")}
        </button>
        <button type="button" onClick={onCancel} className="text-sm underline">
          {t("common:buttons.cancel")}
        </button>
        {incomplete && (
          <span className="text-xs" style={{ color: "var(--warning)" }}>
            {t("roadtrips:stations.incomplete")}
          </span>
        )}
      </div>
    </div>
  );
}
