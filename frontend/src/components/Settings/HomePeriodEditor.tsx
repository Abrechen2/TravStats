import { useEffect, useState } from "react";
import AirportAutocomplete from "../AirportAutocomplete";
import { LocationInput, type LocationSelection } from "../location/LocationInput";
import { useTranslation } from "../../hooks/useTranslation";
import {
  settingsApi,
  type Airport,
  type HomeAirportChoice,
  type HomePeriod,
  type HomeResidence,
  type NearbyHomeAirport,
} from "../../lib/api";
import { logger } from "../../lib/logger";

/**
 * One home period, edited: residence, one to three home airports (one of them
 * the default), and its dates.
 *
 * The residence comes from the app's own place search (`LocationInput`, the
 * same-origin geocoder proxy). Once it is set the server OFFERS the airports
 * nearest to it — an offer, not the list: any airport can be added through
 * the ordinary airport search below, so a field the offer misses never locks
 * the user out of their airport (defect class 1, "a picker offers a subset").
 * A failed offer says so and leaves the search usable (class 3).
 */

export const MAX_HOME_AIRPORTS = 3;

export type HomeEditorMode = "new" | "edit" | "confirm";

interface HomePeriodEditorProps {
  mode: HomeEditorMode;
  /** The period being edited or confirmed; for a new home, the one it replaces (or null). */
  initial: HomePeriod | null;
  /** Today in the profile zone — the default start of a new home. */
  today: string;
  saving: boolean;
  onSave: (period: HomePeriod) => void;
  onCancel: () => void;
}

type NearbyState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "done"; airports: NearbyHomeAirport[] };

function withPrimary(airports: HomeAirportChoice[]): HomeAirportChoice[] {
  if (airports.length === 0 || airports.some((a) => a.primary)) return airports;
  return airports.map((a, i) => ({ ...a, primary: i === 0 }));
}

function residenceName(selection: LocationSelection, previous: string): string {
  return selection.city ?? selection.name ?? previous;
}

export default function HomePeriodEditor({
  mode,
  initial,
  today,
  saving,
  onSave,
  onCancel,
}: HomePeriodEditorProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const isNew = mode === "new";
  const [residence, setResidence] = useState<HomeResidence | null>(
    isNew ? null : (initial?.residence ?? null)
  );
  const [airports, setAirports] = useState<HomeAirportChoice[]>(
    isNew ? [] : (initial?.airports ?? [])
  );
  const [fromDate, setFromDate] = useState(isNew ? today : (initial?.fromDate ?? today));
  const [toDate, setToDate] = useState<string | null>(isNew ? null : (initial?.toDate ?? null));
  const [nearby, setNearby] = useState<NearbyState>({ status: "idle" });
  const [picker, setPicker] = useState<Airport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lat = residence?.lat;
  const lon = residence?.lon;
  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    let live = true;
    setNearby({ status: "loading" });
    settingsApi
      .nearbyHomeAirports(lat, lon)
      .then((found) => {
        if (live) setNearby({ status: "done", airports: found });
      })
      .catch((err: unknown) => {
        logger.error("Failed to load nearby home airports:", err);
        if (live) setNearby({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [lat, lon]);

  const has = (code: string): boolean => airports.some((a) => a.code === code);
  const full = airports.length >= MAX_HOME_AIRPORTS;

  const add = (code: string): void => {
    if (has(code) || full) return;
    setAirports(withPrimary([...airports, { code, primary: false }]));
  };
  const remove = (code: string): void =>
    setAirports(withPrimary(airports.filter((a) => a.code !== code).map((a) => ({ ...a }))));
  const makePrimary = (code: string): void =>
    setAirports(airports.map((a) => ({ code: a.code, primary: a.code === code })));

  const onResidence = (selection: LocationSelection): void =>
    setResidence({
      name: residenceName(selection, residence?.name ?? ""),
      lat: selection.lat,
      lon: selection.lon,
      placeRef: selection.externalRef ?? null,
    });

  const submit = (): void => {
    if (!residence || residence.name.trim() === "") {
      setError(t("settings:homeAirport.errors.residenceMissing"));
      return;
    }
    if (airports.length === 0) {
      setError(t("settings:homeAirport.errors.airportMissing"));
      return;
    }
    setError(null);
    onSave({
      fromDate,
      toDate,
      residence: { ...residence, name: residence.name.trim() },
      residenceConfirmed: true,
      airports,
    });
  };

  const heading =
    mode === "confirm"
      ? t("settings:homeAirport.confirmHeading")
      : mode === "edit"
        ? t("settings:homeAirport.editHeading")
        : initial
          ? t("settings:homeAirport.newHomeHeading")
          : t("settings:homeAirport.initialHomeHeading");

  return (
    <div className="space-y-4" data-testid="home-period-editor">
      <h4 className="font-semibold">{heading}</h4>

      <div>
        <LocationInput
          value={residence ? { lat: residence.lat, lon: residence.lon } : null}
          onChange={onResidence}
          label={t("settings:homeAirport.residenceField")}
          idPrefix="home-residence"
        />
        <p className="t-caption mt-1">{t("settings:homeAirport.residenceHint")}</p>
      </div>
      {residence && (
        <div>
          <label className="label" htmlFor="home-residence-name">
            {t("settings:homeAirport.residenceNameField")}
          </label>
          <input
            id="home-residence-name"
            className="input"
            value={residence.name}
            onChange={(e) => setResidence({ ...residence, name: e.target.value })}
          />
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="label">{t("settings:homeAirport.airportsField")}</legend>
        <p className="t-caption">{t("settings:homeAirport.airportsHint")}</p>
        {airports.length > 0 && (
          <ul className="space-y-1" aria-label={t("settings:homeAirport.airportsField")}>
            {airports.map((a) => (
              <li key={a.code} className="flex flex-wrap items-center gap-2">
                <strong style={{ fontFamily: "var(--ts-font-mono)" }}>{a.code}</strong>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name="home-primary"
                    checked={a.primary}
                    onChange={() => makePrimary(a.code)}
                  />
                  {a.primary
                    ? t("settings:homeAirport.primaryBadge")
                    : t("settings:homeAirport.makePrimary")}
                </label>
                <button type="button" className="btn-secondary" onClick={() => remove(a.code)}>
                  {t("settings:homeAirport.removeAirport")}
                </button>
              </li>
            ))}
          </ul>
        )}

        {nearby.status === "loading" && (
          <p className="t-caption">{t("settings:homeAirport.nearbyLoading")}</p>
        )}
        {nearby.status === "error" && (
          <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
            {t("settings:homeAirport.nearbyError")}
          </p>
        )}
        {nearby.status === "done" && nearby.airports.length === 0 && (
          <p className="t-caption">{t("settings:homeAirport.nearbyNone")}</p>
        )}
        {nearby.status === "done" && nearby.airports.length > 0 && (
          <div>
            <div className="t-caption mb-1">{t("settings:homeAirport.nearbyLabel")}</div>
            <div className="flex flex-wrap gap-2">
              {nearby.airports.map((a) => (
                <label key={a.code} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={has(a.code)}
                    disabled={!has(a.code) && full}
                    onChange={() => (has(a.code) ? remove(a.code) : add(a.code))}
                  />
                  <span>
                    <strong>{a.code}</strong> {a.city ?? a.name} ·{" "}
                    {t("settings:homeAirport.nearbyDistance", { km: a.distanceKm })}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {full ? (
          <p className="t-caption">{t("settings:homeAirport.maxAirports")}</p>
        ) : (
          <AirportAutocomplete
            value={picker}
            onChange={(airport) => {
              setPicker(null);
              if (airport?.iata) add(airport.iata.toUpperCase());
            }}
            label={t("settings:homeAirport.addAirport")}
            placeholder={t("settings:homeAirport.airportPlaceholder")}
          />
        )}
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <div>
          <label className="label" htmlFor="home-from">
            {t("settings:homeAirport.fromDateField")}
          </label>
          <input
            id="home-from"
            type="date"
            className="input"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            max={today}
          />
        </div>
        {toDate !== null && (
          <div>
            <label className="label" htmlFor="home-to">
              {t("settings:homeAirport.toDateField")}
            </label>
            <input
              id="home-to"
              type="date"
              className="input"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        )}
      </div>
      {isNew && <p className="t-caption">{t("settings:homeAirport.fromDateHint")}</p>}

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" className="btn-primary" onClick={submit} disabled={saving}>
          {saving ? t("common:buttons.saving") : t("common:buttons.save")}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          {t("common:buttons.cancel")}
        </button>
      </div>
    </div>
  );
}
