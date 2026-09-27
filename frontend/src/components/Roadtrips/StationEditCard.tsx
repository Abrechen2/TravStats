import { useState } from "react";
import type { CSSProperties, JSX } from "react";

import Button from "../ui/Button";
import { Field, Input } from "../ui/Field";
import { LocationInput } from "../location/LocationInput";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { nextMorning } from "../../lib/roadtrip/roadtripView";
import type { StationState } from "../../shared/tour/roadtrip";
import StationMarker from "./StationMarker";
import StayPicker, { type PickableStay } from "./StayPicker";
import { isOtherPlace } from "./stayPickerModel";
import type { EditorStation } from "./useStationAutosave";
import type { Lodging } from "../../types/lodging";

const KINDS: StationState[] = ["stay", "free", "pass", "via"];

/** Where the station's linked lodging is: picked just now, or found in the library. */
function linkedPlace(
  station: EditorStation,
  lodgings: Lodging[] | null
): { lat: number | null; lon: number | null } | null {
  if (station.stayPlace) return station.stayPlace;
  const lodging = lodgings?.find((l) => l.id === station.stayLodgingId);
  return lodging ? { lat: lodging.lat ?? null, lon: lodging.lon ?? null } : null;
}

const HUE: Record<StationState, string> = {
  stay: "var(--domain-lodging)",
  free: "var(--domain-roadtrip)",
  pass: "var(--ts-muted)",
  via: "var(--ts-muted)",
};

/** `YYYY-MM-DD` for a date input from whatever the draft holds. */
function dayInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

/**
 * One station opened for editing (board 3), in the order a reader thinks
 * it: what was here, where, when, and — for a night at a stay — which stay.
 * The three states are three large choices, each saying what it means,
 * because "Übernachtung" as a checkbox plus an optional field could express
 * a stay night with no stay, which the server refuses.
 */
export default function StationEditCard({
  station,
  position,
  total,
  tripId,
  lodgings,
  onChange,
  onClose,
}: {
  station: EditorStation;
  position: number;
  total: number;
  tripId: string | null;
  lodgings: Lodging[] | null;
  onChange: (patch: Partial<EditorStation>) => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const display = useDisplayFormat();
  const kind = station.night.kind;
  const [picking, setPicking] = useState(kind === "stay" && !station.night.lodgingStayId);
  const arrival = dayInput(station.startDate);
  const departure = dayInput(station.endDate);
  const idBase = `station-${station.key}`;

  const choose = (next: StationState): void => {
    if (next === kind) return;
    if (next === "stay") {
      // A stay night waits for its stay; the picker opens at once.
      onChange({
        night: { kind: "stay", lodgingStayId: null },
        stayLabel: undefined,
        stayCancelled: false,
        stayLodgingId: undefined,
        stayPlace: undefined,
      });
      setPicking(true);
      return;
    }
    onChange({
      night: { kind: next },
      // A route correction carries no day (the server refuses one).
      ...(next === "via" ? { startDate: null, endDate: null } : {}),
      stayLabel: undefined,
      stayCancelled: false,
      stayLodgingId: undefined,
      stayPlace: undefined,
    });
    setPicking(false);
  };

  /**
   * Linking a stay places a station that has no point yet at its lodging —
   * without that the station waited forever on "Ort fehlt" and nothing was
   * saved (tester 2026-09-26). A station that already has a point keeps it;
   * the card offers the lodging's instead of moving it.
   */
  const pickStay = (stay: PickableStay): void => {
    const unplaced = station.lat === null || station.lon === null;
    const lodgingPlaced = stay.lat !== null && stay.lon !== null;
    onChange({
      night: { kind: "stay", lodgingStayId: stay.id },
      stayLabel: stay.label,
      stayCancelled: stay.cancelled,
      stayLodgingId: stay.lodgingId,
      stayPlace: { lat: stay.lat, lon: stay.lon },
      startDate: station.startDate || stay.checkIn,
      endDate: station.endDate || stay.checkOut,
      title: station.title.trim() === "" ? stay.label : station.title,
      ...(unplaced && lodgingPlaced ? { lat: stay.lat, lon: stay.lon } : {}),
    });
    setPicking(false);
  };

  const stayPlace = kind === "stay" ? linkedPlace(station, lodgings) : null;
  const stayUnplaced = stayPlace !== null && (stayPlace.lat === null || stayPlace.lon === null);
  const adoptable =
    stayPlace !== null &&
    stayPlace.lat !== null &&
    stayPlace.lon !== null &&
    station.lat !== null &&
    station.lon !== null &&
    isOtherPlace({ lat: station.lat, lon: station.lon }, { lat: stayPlace.lat, lon: stayPlace.lon })
      ? { lat: stayPlace.lat, lon: stayPlace.lon }
      : null;

  const choiceStyle = (k: StationState): CSSProperties => {
    const on = k === kind;
    return {
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: 8,
      minHeight: 112,
      padding: 14,
      borderRadius: 14,
      textAlign: "left",
      cursor: "pointer",
      color: "inherit",
      background: on ? `color-mix(in srgb, ${HUE[k]} 8%, transparent)` : "var(--ts-surface2)",
      border: `2px solid ${on ? `color-mix(in srgb, ${HUE[k]} 60%, transparent)` : "var(--ts-border)"}`,
    };
  };

  return (
    <div
      className="flex flex-col"
      style={{
        gap: "var(--ts-space-lg)",
        padding: "var(--ts-space-lg)",
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface)",
        border: "1px solid color-mix(in srgb, var(--domain-roadtrip) 45%, transparent)",
      }}
    >
      <div className="flex items-center" style={{ gap: 12 }}>
        <StationMarker state={kind} cancelled={station.stayCancelled} />
        <span style={{ fontSize: 18, fontWeight: 800, color: "var(--ts-text-bright)" }}>
          {station.title.trim() ||
            (kind === "via" ? t("roadtrips:night.via") : t("roadtrips:editor.unnamed"))}
        </span>
        <span className="t-caption">{t("roadtrips:editor.stationOf", { n: position, total })}</span>
      </div>

      <fieldset className="flex flex-col" style={{ gap: 10, border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          {t("roadtrips:editor.whatHere")}
        </legend>
        <div
          role="radiogroup"
          aria-label={t("roadtrips:editor.whatHere")}
          className="grid grid-cols-2 lg:grid-cols-4"
          style={{ gap: 10 }}
        >
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={k === kind}
              onClick={() => choose(k)}
              style={choiceStyle(k)}
            >
              <StationMarker state={k} />
              <span style={{ fontSize: 15, fontWeight: 800 }}>
                {t(`roadtrips:editor.choice.${k}.label`)}
              </span>
              <span className="t-caption">{t(`roadtrips:editor.choice.${k}.hint`)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <LocationInput
        compact
        idPrefix={`${idBase}-location`}
        label={t("roadtrips:editor.place")}
        value={
          station.lat !== null && station.lon !== null
            ? { lat: station.lat, lon: station.lon }
            : null
        }
        onChange={(sel) =>
          onChange({
            lat: sel.lat,
            lon: sel.lon,
            // A correction stays nameless unless the reader types one.
            title:
              station.title.trim() === "" && sel.name && kind !== "via" ? sel.name : station.title,
          })
        }
      />
      <Field label={t("roadtrips:editor.name")} htmlFor={`${idBase}-title`}>
        <Input
          id={`${idBase}-title`}
          value={station.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </Field>

      {kind === "via" && <p className="t-caption">{t("roadtrips:editor.viaNote")}</p>}
      {kind !== "via" && (
        <div className="grid sm:grid-cols-2" style={{ gap: 10 }}>
          <Field
            label={kind === "pass" ? t("roadtrips:editor.date") : t("roadtrips:editor.arrival")}
            htmlFor={`${idBase}-start`}
          >
            <Input
              id={`${idBase}-start`}
              type="date"
              value={arrival}
              onChange={(e) => onChange({ startDate: e.target.value || null })}
            />
          </Field>
          {kind !== "pass" && (
            <Field label={t("roadtrips:editor.departure")} htmlFor={`${idBase}-end`}>
              <Input
                id={`${idBase}-end`}
                type="date"
                value={departure}
                min={arrival || undefined}
                invalid={arrival !== "" && departure === ""}
                onChange={(e) => onChange({ endDate: e.target.value || null })}
              />
            </Field>
          )}
        </div>
      )}
      {kind !== "pass" && kind !== "via" && arrival !== "" && departure === "" && (
        <div
          className="flex flex-wrap items-center"
          style={{ gap: 10, fontSize: 13, color: "var(--ts-warn)" }}
        >
          {t("roadtrips:editor.noDepartureHint")}
          <Button variant="secondary" onClick={() => onChange({ endDate: nextMorning(arrival) })}>
            {t("roadtrips:editor.nextMorning", {
              date: display.date(`${nextMorning(arrival)}T00:00:00Z`, {
                timeZone: "UTC",
                omitYear: true,
              }),
            })}
          </Button>
        </div>
      )}

      {kind === "stay" && (
        <div
          className="flex flex-col"
          style={{ gap: 10, paddingTop: 14, borderTop: "1px solid var(--ts-border)" }}
        >
          <span style={{ fontSize: 14, fontWeight: 700 }}>{t("roadtrips:editor.whereSlept")}</span>
          {station.night.lodgingStayId && !picking ? (
            <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
              <StationMarker state="stay" size="sm" cancelled={station.stayCancelled} />
              <span style={{ fontWeight: 700 }}>
                {station.stayLabel ?? t("roadtrips:stay.linked")}
              </span>
              {station.stayCancelled && (
                <span style={{ fontSize: 12, color: "var(--ts-warn)" }}>
                  {t("roadtrips:stay.cancelled")}
                </span>
              )}
              <Button variant="secondary" onClick={() => setPicking(true)}>
                {t("roadtrips:stay.change")}
              </Button>
              {adoptable && (
                <Button variant="secondary" onClick={() => onChange(adoptable)}>
                  {t("roadtrips:stay.adoptPlace")}
                </Button>
              )}
              {stayUnplaced && (
                <span className="w-full" style={{ fontSize: 12, color: "var(--ts-warn)" }}>
                  {t("roadtrips:stay.noCoords")}
                </span>
              )}
            </div>
          ) : (
            <StayPicker
              selectedStayId={station.night.lodgingStayId}
              near={{ startDate: station.startDate ?? null, endDate: station.endDate ?? null }}
              place={{ name: station.title, lat: station.lat, lon: station.lon }}
              tripId={tripId}
              lodgings={lodgings}
              onPick={pickStay}
            />
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="primary" onClick={onClose}>
          {t("roadtrips:editor.close")}
        </Button>
      </div>
    </div>
  );
}
