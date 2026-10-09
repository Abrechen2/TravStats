import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { rentalApi } from "../../lib/api/rental";
import { logger } from "../../lib/logger";
import type { RentalStationHit } from "../../types/rental";
import { countryName } from "../../shared/geo/countryCode";
import { LocationInput, type LocationSelection } from "../location/LocationInput";
import { FieldError, RequiredMark, fieldErrorProps } from "../form";
import { EMPTY_RENTAL_STATION, stationFromHit, type RentalStationDraft } from "./rentalFormModel";

interface Props {
  label: string;
  idPrefix: string;
  value: RentalStationDraft;
  onChange: (next: RentalStationDraft) => void;
  inputClassName: string;
  /** Already translated; shown beside — and tied to — the control in use. */
  error?: string | null;
  required?: boolean;
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

type SearchState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "done"; hits: RentalStationHit[] }
  | { kind: "error" };

/**
 * A rental station (spec 2026-10-01-rental-domain-design §3.2, §6): an airport
 * or one of the user's earlier stations, with the geocoder search as the way
 * to any address. Every hit the server answers is offered (silent-failure
 * class 1) and a pick carries its position, country and airport into the row
 * (class 2); a failed search says so rather than looking like "no station".
 *
 * Typing replaces the station: the text is a search, and an edited name over
 * the old position would be a pin in the wrong town.
 */
export function RentalStationPicker({
  label,
  idPrefix,
  value,
  onChange,
  inputClassName,
  error,
  required = false,
}: Props): JSX.Element {
  const { t, i18n } = useTranslation(["rental"]);
  const [mode, setMode] = useState<"search" | "address">(
    value.airportId === null && value.lat !== null ? "address" : "search"
  );
  const [query, setQuery] = useState(value.name);
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const showingPick = value.lat !== null && query === value.name;

  useEffect(() => {
    if (mode !== "search" || query.trim().length < MIN_QUERY || showingPick) {
      setSearch({ kind: "idle" });
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      setSearch({ kind: "searching" });
      rentalApi
        .searchStations(query.trim())
        .then((hits) => {
          if (!cancelled) setSearch({ kind: "done", hits });
        })
        .catch((err: unknown) => {
          logger.warn("RentalStationPicker: station search failed", err);
          if (!cancelled) setSearch({ kind: "error" });
        });
    }, DEBOUNCE_MS);
    return (): void => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [mode, query, showingPick]);

  const pick = (hit: RentalStationHit): void => {
    onChange(stationFromHit(hit));
    setQuery(hit.name);
    setSearch({ kind: "idle" });
  };

  const handleAddress = useCallback(
    (selection: LocationSelection): void => {
      onChange({
        name: value.name || selection.name || "",
        airportId: null,
        iata: null,
        address: selection.address ?? selection.name ?? null,
        lat: selection.lat,
        lon: selection.lon,
        country: selection.countryCode ? selection.countryCode.toUpperCase() : null,
        // A geocoder hit carries no zone; the server derives it on save.
        timezone: null,
      });
    },
    [onChange, value.name]
  );

  const searchId = `${idPrefix}-search`;
  const nameId = `${idPrefix}-name`;
  const requiredProps = required ? { "aria-required": true as const } : {};

  if (mode === "address") {
    const position =
      value.lat !== null && value.lon !== null ? { lat: value.lat, lon: value.lon } : null;
    return (
      <div className="space-y-2">
        <LocationInput
          label={label}
          idPrefix={idPrefix}
          value={position}
          onChange={handleAddress}
          compact
        />
        {/* A visible label: a placeholder alone is gone once typed into (forgejo#249). */}
        <label htmlFor={nameId} className="block text-sm">
          {`${label}: ${t("rental:form.stationName")}`} {required ? <RequiredMark /> : null}
        </label>
        <input
          id={nameId}
          className={inputClassName}
          value={value.name}
          onChange={(e): void => onChange({ ...value, name: e.target.value })}
          {...requiredProps}
          {...fieldErrorProps(nameId, error)}
        />
        <FieldError id={nameId} error={error} />
        <button
          type="button"
          className="text-xs text-(--accent) underline pointer-coarse:min-h-(--ts-size-touch-min)"
          onClick={(): void => setMode("search")}
        >
          {t("rental:station.backToSearch")}
        </button>
      </div>
    );
  }

  const listId = `${idPrefix}-stations`;
  const hits = search.kind === "done" ? search.hits : [];
  return (
    <div className="space-y-1">
      <label className="block text-sm" htmlFor={searchId}>
        {label} {required ? <RequiredMark /> : null}
      </label>
      <input
        id={searchId}
        {...requiredProps}
        {...fieldErrorProps(searchId, error)}
        className={inputClassName}
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={t("rental:station.searchPlaceholder")}
        value={query}
        onChange={(e): void => {
          setQuery(e.target.value);
          onChange({ ...EMPTY_RENTAL_STATION, name: e.target.value });
        }}
      />
      {value.iata ? (
        <p className="t-caption">{t("rental:station.picked", { code: value.iata })}</p>
      ) : null}
      {search.kind === "searching" ? (
        <p className="t-caption">{t("rental:station.searching")}</p>
      ) : null}
      {search.kind === "error" ? (
        <p role="alert" className="text-xs text-(--danger)">
          {t("rental:station.searchError")}
        </p>
      ) : null}
      {search.kind === "done" && hits.length === 0 ? (
        <p className="t-caption">{t("rental:station.noHits")}</p>
      ) : null}
      {hits.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="max-h-56 overflow-y-auto rounded-md border border-border bg-(--bg-surface)"
        >
          {hits.map((hit) => (
            <li
              key={`${hit.kind}-${hit.airportId ?? ""}-${hit.lat}-${hit.lon}`}
              role="option"
              aria-selected={false}
            >
              <button
                type="button"
                className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-(--bg-base) pointer-coarse:min-h-(--ts-size-touch-min)"
                onClick={(): void => pick(hit)}
              >
                <span>
                  {hit.name}
                  {hit.iata ? <span className="ml-1 font-mono text-xs">({hit.iata})</span> : null}
                </span>
                <span className="t-caption">
                  {[
                    hit.kind === "earlier" ? t("rental:station.earlier") : hit.city,
                    countryName(hit.country, i18n.language) || hit.country,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <FieldError id={searchId} error={error} />
      <button
        type="button"
        className="text-xs text-(--accent) underline pointer-coarse:min-h-(--ts-size-touch-min)"
        onClick={(): void => setMode("address")}
      >
        {t("rental:station.useAddress")}
      </button>
    </div>
  );
}
