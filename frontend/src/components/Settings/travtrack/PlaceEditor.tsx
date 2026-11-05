import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { parseCoordinateInput } from "../../../lib/coordinateParse";
import {
  PLACE_RADIUS_MAX,
  PLACE_RADIUS_MIN,
  type FixedPlace,
  type FixedPlaceInput,
  type PlaceWindow,
} from "../../../lib/api/travtrackPlaces";
import Button from "../../ui/Button";
import { Field, Input, Select } from "../../ui/Field";
import { RowFailure } from "../location/useRowAction";

const NS = "settings:tt.places";
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const DEFAULT_RADIUS = 150;
const DEFAULT_WINDOW: PlaceWindow = { days: [1, 2, 3, 4, 5], from: "08:00", until: "18:00" };

/** What the editor hands back: the full body, or radius and window for home. */
export type PlaceDraft =
  | { home: false; input: FixedPlaceInput }
  | { home: true; input: { radiusM: number; window: PlaceWindow | null } };

/**
 * The inline form of one fixed place: name, kind, centre, radius and an
 * optional weekday/time window. Home is edited by radius and window only — its
 * centre is the residence, changed under the profile, never here.
 */
export default function PlaceEditor({
  place,
  busy,
  error,
  onSave,
  onCancel,
  onRetry,
}: {
  /** null = a new place. */
  place: FixedPlace | null;
  busy: boolean;
  error: string | null;
  onSave: (draft: PlaceDraft) => void;
  onCancel: () => void;
  onRetry: () => void;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const home = place?.kind === "home";
  const [name, setName] = useState(place?.name ?? "");
  const [kind, setKind] = useState<"work" | "custom">(place?.kind === "work" ? "work" : "custom");
  const [centre, setCentre] = useState(
    place?.lat != null && place.lon != null ? `${place.lat}, ${place.lon}` : ""
  );
  const [radius, setRadius] = useState(String(place?.radiusM ?? DEFAULT_RADIUS));
  const [timed, setTimed] = useState(place?.window != null);
  const [days, setDays] = useState<number[]>(place?.window?.days ?? DEFAULT_WINDOW.days);
  const [from, setFrom] = useState(place?.window?.from ?? DEFAULT_WINDOW.from);
  const [until, setUntil] = useState(place?.window?.until ?? DEFAULT_WINDOW.until);

  const point = parseCoordinateInput(centre);
  const radiusM = Number(radius);
  const radiusOk =
    Number.isInteger(radiusM) && radiusM >= PLACE_RADIUS_MIN && radiusM <= PLACE_RADIUS_MAX;
  const windowOk = !timed || (days.length > 0 && from !== "" && until !== "");
  const valid = radiusOk && windowOk && (home || (name.trim() !== "" && point !== null));
  const window: PlaceWindow | null = timed ? { days: [...days].sort(), from, until } : null;

  const save = (): void => {
    if (!valid) return;
    if (home) {
      onSave({ home: true, input: { radiusM, window } });
    } else if (point) {
      onSave({
        home: false,
        input: { name: name.trim(), kind, lat: point.lat, lon: point.lon, radiusM, window },
      });
    }
  };

  const toggleDay = (day: number): void =>
    setDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day]
    );

  return (
    <div
      className="flex flex-col"
      style={{ gap: "var(--ts-space-sm)" }}
      role="group"
      aria-label={t(`${NS}.editor.${place ? "edit" : "add"}`)}
    >
      {home ? (
        <p className="t-caption" style={{ margin: 0 }}>
          {t(`${NS}.editor.homeNote`)}
        </p>
      ) : (
        <>
          <Field label={t(`${NS}.editor.name`)} htmlFor="tt-place-name">
            <Input
              id="tt-place-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t(`${NS}.editor.kind`)} htmlFor="tt-place-kind">
            <Select
              id="tt-place-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as "work" | "custom")}
            >
              <option value="work">{t(`${NS}.kinds.work`)}</option>
              <option value="custom">{t(`${NS}.kinds.custom`)}</option>
            </Select>
          </Field>
          <Field
            label={t(`${NS}.editor.centre`)}
            htmlFor="tt-place-centre"
            hint={t(`${NS}.editor.centreHint`)}
            error={
              centre.trim() !== "" && point === null ? t(`${NS}.editor.centreInvalid`) : undefined
            }
          >
            <Input
              id="tt-place-centre"
              value={centre}
              onChange={(e) => setCentre(e.target.value)}
            />
          </Field>
        </>
      )}
      <Field
        label={t(`${NS}.editor.radius`)}
        htmlFor="tt-place-radius"
        hint={t(`${NS}.editor.radiusHint`, { min: PLACE_RADIUS_MIN, max: PLACE_RADIUS_MAX })}
        error={
          radiusOk
            ? undefined
            : t(`${NS}.editor.radiusInvalid`, { min: PLACE_RADIUS_MIN, max: PLACE_RADIUS_MAX })
        }
      >
        <Input
          id="tt-place-radius"
          type="number"
          inputMode="numeric"
          min={PLACE_RADIUS_MIN}
          max={PLACE_RADIUS_MAX}
          value={radius}
          onChange={(e) => setRadius(e.target.value)}
        />
      </Field>
      <label className="flex items-center t-body" style={{ gap: "var(--ts-space-sm)" }}>
        <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} />
        {t(`${NS}.editor.timed`)}
      </label>
      {timed ? (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          <div className="flex flex-wrap" style={{ gap: "var(--ts-space-xs)" }}>
            {WEEKDAYS.map((day) => (
              <Button
                key={day}
                aria-pressed={days.includes(day)}
                variant={days.includes(day) ? "primary" : undefined}
                onClick={() => toggleDay(day)}
              >
                {t(`${NS}.days.${day}`)}
              </Button>
            ))}
          </div>
          {days.length === 0 ? (
            <p role="alert" className="t-caption" style={{ margin: 0 }}>
              {t(`${NS}.editor.daysNeeded`)}
            </p>
          ) : null}
          <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
            <Field label={t(`${NS}.editor.from`)} htmlFor="tt-place-from">
              <Input
                id="tt-place-from"
                type="time"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label={t(`${NS}.editor.until`)} htmlFor="tt-place-until">
              <Input
                id="tt-place-until"
                type="time"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </Field>
          </div>
          <p className="t-caption" style={{ margin: 0 }}>
            {t(`${NS}.editor.windowHint`)}
          </p>
        </div>
      ) : null}
      <div className="flex" style={{ gap: "var(--ts-space-sm)" }}>
        <Button variant="primary" disabled={!valid || busy} onClick={save}>
          {t(`${NS}.editor.save`)}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          {t(`${NS}.editor.cancel`)}
        </Button>
      </div>
      <RowFailure error={error} onRetry={onRetry} />
    </div>
  );
}
