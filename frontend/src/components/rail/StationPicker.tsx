import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { railApi } from "../../lib/api/rail";
import { logger } from "../../lib/logger";
import type { RailStationHit } from "../../types/rail";
import { EMPTY_STATION, RailStationField, type RailStationDraft } from "./RailStationField";

interface Props {
  label: string;
  idPrefix: string;
  value: RailStationDraft;
  onChange: (next: RailStationDraft) => void;
  onValidityChange?: (valid: boolean) => void;
  inputClassName: string;
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

type SearchState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "done"; hits: RailStationHit[] }
  | { kind: "error" };

/** A station as the form holds it, from a catalogue row. */
export function draftFromHit(hit: RailStationHit): RailStationDraft {
  return {
    name: hit.name,
    lat: hit.lat,
    lon: hit.lon,
    country: hit.country,
    code: hit.uic,
    stationId: hit.id,
  };
}

/**
 * A station from the catalogue (Trainline stations.csv, ODbL — spec
 * 2026-09-25-rail-domain, phase 2), with the geocoder search as the way out
 * for a station the catalogue does not know.
 *
 * Typing replaces the station: the text is a search, and a changed text with
 * the old position under it would be a pin in the wrong town. The form stays
 * unsaveable until a hit is picked — the same rule the geocoder field keeps.
 */
export function StationPicker({
  label,
  idPrefix,
  value,
  onChange,
  onValidityChange,
  inputClassName,
}: Props): JSX.Element {
  const { t } = useTranslation(["rail"]);
  // A station already chosen through the geocoder opens in that mode, so an
  // edit shows what was picked instead of an empty search.
  const [mode, setMode] = useState<"catalogue" | "geocoder">(
    value.stationId === null && value.lat !== null ? "geocoder" : "catalogue"
  );
  const [query, setQuery] = useState(value.name);
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });

  // A station set from outside (a train lookup) replaces what the field
  // shows. Keyed on the position, not the name: typing changes the name, and
  // syncing on it would fight the user's own keystrokes.
  useEffect(() => {
    if (value.lat === null) return;
    setQuery(value.name);
    if (value.stationId !== null) setMode("catalogue");
  }, [value.lat, value.lon, value.stationId]);

  const showingPick = value.lat !== null && query === value.name;

  useEffect(() => {
    if (mode !== "catalogue" || query.trim().length < MIN_QUERY || showingPick) {
      setSearch({ kind: "idle" });
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      setSearch({ kind: "searching" });
      railApi
        .searchStations(query.trim())
        .then((hits) => {
          if (!cancelled) setSearch({ kind: "done", hits });
        })
        .catch((err: unknown) => {
          logger.warn("StationPicker: station search failed", err);
          if (!cancelled) setSearch({ kind: "error" });
        });
    }, DEBOUNCE_MS);
    return (): void => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [mode, query, showingPick]);

  const pick = (hit: RailStationHit): void => {
    onChange(draftFromHit(hit));
    setQuery(hit.name);
    setSearch({ kind: "idle" });
  };

  const switchMode = (next: "catalogue" | "geocoder"): void => {
    setMode(next);
    setSearch({ kind: "idle" });
    onValidityChange?.(true);
  };

  if (mode === "geocoder") {
    return (
      <div className="space-y-2">
        <RailStationField
          label={label}
          idPrefix={idPrefix}
          value={value}
          onChange={onChange}
          onValidityChange={onValidityChange}
          inputClassName={inputClassName}
        />
        <button
          type="button"
          className="text-xs text-(--accent) underline"
          onClick={(): void => switchMode("catalogue")}
        >
          {t("rail:station.backToCatalogue")}
        </button>
      </div>
    );
  }

  const listId = `${idPrefix}-stations`;
  return (
    <div className="space-y-1">
      <label className="text-sm" htmlFor={`${idPrefix}-search`}>
        {label}
      </label>
      <input
        id={`${idPrefix}-search`}
        className={inputClassName}
        role="combobox"
        aria-expanded={search.kind === "done" && search.hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={t("rail:station.searchPlaceholder")}
        value={query}
        onChange={(e): void => {
          setQuery(e.target.value);
          onChange({ ...EMPTY_STATION, name: e.target.value });
        }}
      />
      {value.stationId !== null && value.code ? (
        <p className="t-caption">{t("rail:station.picked", { code: value.code })}</p>
      ) : null}
      {search.kind === "searching" ? (
        <p className="t-caption">{t("rail:station.searching")}</p>
      ) : null}
      {search.kind === "error" ? (
        <p role="alert" className="text-xs text-(--danger)">
          {t("rail:station.searchError")}
        </p>
      ) : null}
      {search.kind === "done" && search.hits.length === 0 ? (
        <p className="t-caption">{t("rail:station.noHits")}</p>
      ) : null}
      {search.kind === "done" && search.hits.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="max-h-56 overflow-y-auto rounded-md border border-border bg-(--bg-surface)"
        >
          {search.hits.map((hit) => (
            <li key={hit.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-(--bg-base)"
                onClick={(): void => pick(hit)}
              >
                <span>{hit.name}</span>
                <span className="t-caption">
                  {[hit.country, hit.uic].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="text-xs text-(--accent) underline"
        onClick={(): void => switchMode("geocoder")}
      >
        {t("rail:station.useGeocoder")}
      </button>
    </div>
  );
}
