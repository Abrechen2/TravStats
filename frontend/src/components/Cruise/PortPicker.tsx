import { useEffect, useState } from "react";
import { portsApi, type GeocodedPort } from "../../lib/api";
import type { Port } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

interface Props {
  value: Port | null;
  onChange: (port: Port) => void;
  /** Visible field label (e.g. departure vs arrival port). */
  label?: string;
}

/**
 * Combobox-style port picker.
 *
 * - Debounced (250ms) search against `portsApi.search`.
 * - Shows a dropdown with "name — city, country" for each match.
 * - Offers an "add custom" flow when no exact-name match is present, capturing
 *   required lat/lon and optional city/country, then creating via `portsApi.create`.
 */
export function PortPicker({ value, onChange, label }: Props): JSX.Element {
  const { t } = useTranslation("cruise");
  const [query, setQuery] = useState<string>(value?.name ?? "");
  const [results, setResults] = useState<Port[]>([]);
  // External geocoder fallback: populated only when the local catalog has no
  // match, so a user can still find ports missing from the vendored CSV
  // (e.g. Taranto) without typing coordinates by hand.
  const [geocoded, setGeocoded] = useState<GeocodedPort[]>([]);
  const [searching, setSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<boolean>(false);
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [newCity, setNewCity] = useState<string>("");
  const [newCountry, setNewCountry] = useState<string>("");
  const [newLat, setNewLat] = useState<string>("");
  const [newLon, setNewLon] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Don't search when the field merely shows the already-selected port —
    // otherwise the dropdown re-opens right after a pick and on modal open.
    if (!query || query.length < 2 || query === value?.name) {
      setResults([]);
      setGeocoded([]);
      setSearchError(false);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setSearching(true);
      setSearchError(false);
      try {
        const r = await portsApi.search(query);
        if (cancelled) return;
        const local = Array.isArray(r) ? r : [];
        setResults(local);
        // Only reach out to the external geocoder when the local catalog has
        // nothing — keeps it cheap and offline-first.
        if (local.length === 0) {
          const g = await portsApi.geocode(query);
          if (!cancelled) setGeocoded(Array.isArray(g) ? g : []);
        } else {
          setGeocoded([]);
        }
      } catch {
        // Surface the failure instead of silently showing "no results", which
        // previously masked auth/network errors as an empty catalog.
        if (!cancelled) {
          setResults([]);
          setGeocoded([]);
          setSearchError(true);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return (): void => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, value?.name]);

  const exactMatch = results.some((r) => r.name.toLowerCase() === query.toLowerCase());

  const formatLocation = (p: Port): string => {
    const parts: string[] = [];
    if (p.city) parts.push(p.city);
    if (p.country) parts.push(p.country);
    return parts.join(", ");
  };

  const handleSelect = (port: Port): void => {
    onChange(port);
    setQuery(port.name);
    setResults([]);
    setGeocoded([]);
  };

  // Persist a geocoder candidate as a real port, then select it. Saves the
  // user from re-typing name/coordinates in the manual "add custom" form.
  const handleSelectGeocoded = async (g: GeocodedPort): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const port = await portsApi.create({
        name: g.name,
        city: g.city ?? undefined,
        country: g.country ?? undefined,
        lat: g.lat,
        lon: g.lon,
      });
      onChange(port);
      setQuery(port.name);
      setResults([]);
      setGeocoded([]);
    } catch {
      setError(t("picker.createPortError"));
    } finally {
      setSaving(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!newName) return;
    const lat = Number.parseFloat(newLat);
    const lon = Number.parseFloat(newLon);
    if (
      Number.isNaN(lat) ||
      Number.isNaN(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      setError(t("picker.invalidLatLon"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const port = await portsApi.create({
        name: newName,
        city: newCity || undefined,
        country: newCountry || undefined,
        lat,
        lon,
      });
      onChange(port);
      setQuery(port.name);
      setResults([]);
      setShowAdd(false);
      setNewName("");
      setNewCity("");
      setNewCountry("");
      setNewLat("");
      setNewLon("");
    } catch {
      setError(t("picker.createPortError"));
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(newName) && newLat !== "" && newLon !== "";

  return (
    <div className="relative">
      {label !== undefined && (
        <span className="mb-1 block text-xs text-(--text-muted)">{label}</span>
      )}
      <input
        role="combobox"
        aria-expanded={results.length > 0}
        aria-autocomplete="list"
        aria-label={label ?? t("picker.port_placeholder")}
        className="w-full rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-hidden"
        placeholder={t("picker.port_placeholder")}
        value={query}
        onChange={(e): void => setQuery(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-(--bg-surface) shadow-lg">
          {results.map((r) => {
            const location = formatLocation(r);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-(--text-primary) hover:bg-(--bg-elevated)"
                  onClick={(): void => handleSelect(r)}
                >
                  {r.name}
                  {location && <span className="text-(--text-muted)"> — {location}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {/* Geocoder fallback — only shown when the local catalog had no match. */}
      {results.length === 0 && geocoded.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-(--bg-surface) shadow-lg">
          <li className="px-3 py-1 text-[10px] uppercase tracking-wide text-(--text-muted)">
            {t("picker.via_geocoder")}
          </li>
          {geocoded.map((g, i) => {
            const location = [g.city, g.country].filter(Boolean).join(", ");
            return (
              <li key={`${g.lat},${g.lon},${i}`}>
                <button
                  type="button"
                  disabled={saving}
                  className="w-full px-3 py-2 text-left text-sm text-(--text-primary) hover:bg-(--bg-elevated) disabled:opacity-50"
                  onClick={(): void => {
                    void handleSelectGeocoded(g);
                  }}
                >
                  {g.name}
                  {location && <span className="text-(--text-muted)"> — {location}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {searchError && (
        <p className="mt-1 text-xs text-(--danger)">{t("picker.searchError")}</p>
      )}
      {/* Create/persist errors — rendered HERE, not only inside the add-custom
          form: a failed geocoder-candidate save (handleSelectGeocoded) sets
          this too, and until 2026-08-02 it had no render site on that path,
          so the failure was invisible. */}
      {error !== null && !showAdd && <p className="mt-1 text-xs text-(--danger)">{error}</p>}
      {query.length >= 2 &&
        query !== value?.name &&
        !exactMatch &&
        geocoded.length === 0 &&
        !searching &&
        !showAdd && (
          <button
            type="button"
            className="mt-2 text-xs text-(--accent) hover:underline"
            onClick={(): void => {
              setNewName(query);
              setShowAdd(true);
            }}
          >
            {t("picker.add_custom_port")}
          </button>
        )}
      {showAdd && (
        <div className="mt-2 space-y-2 rounded-md border border-border bg-(--bg-surface) p-3">
          <input
            className="w-full rounded-md border border-border bg-(--bg-elevated) px-2 py-1 text-sm text-(--text-primary) placeholder:text-(--text-muted)"
            value={newName}
            onChange={(e): void => setNewName(e.target.value)}
            placeholder={t("field.port_name")}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className="rounded-md border border-border bg-(--bg-elevated) px-2 py-1 text-sm text-(--text-primary) placeholder:text-(--text-muted)"
              value={newCity}
              onChange={(e): void => setNewCity(e.target.value)}
              placeholder={t("field.city")}
            />
            <input
              className="rounded-md border border-border bg-(--bg-elevated) px-2 py-1 text-sm text-(--text-primary) placeholder:text-(--text-muted)"
              value={newCountry}
              onChange={(e): void => setNewCountry(e.target.value)}
              placeholder={t("field.country")}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              step="0.001"
              min={-90}
              max={90}
              className="rounded-md border border-border bg-(--bg-elevated) px-2 py-1 text-sm text-(--text-primary) placeholder:text-(--text-muted)"
              value={newLat}
              onChange={(e): void => setNewLat(e.target.value)}
              placeholder={t("field.lat")}
            />
            <input
              type="number"
              step="0.001"
              min={-180}
              max={180}
              className="rounded-md border border-border bg-(--bg-elevated) px-2 py-1 text-sm text-(--text-primary) placeholder:text-(--text-muted)"
              value={newLon}
              onChange={(e): void => setNewLon(e.target.value)}
              placeholder={t("field.lon")}
            />
          </div>
          {error !== null && <p className="text-xs text-(--danger)">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={(): void => {
                setShowAdd(false);
                setError(null);
              }}
              className="text-xs text-(--text-muted) hover:text-(--text-primary)"
            >
              {t("picker.cancel")}
            </button>
            <button
              type="button"
              disabled={saving || !canSave}
              onClick={(): void => {
                void save();
              }}
              className="rounded-md bg-(--accent) px-2 py-1 text-xs font-medium text-neutral-900 hover:bg-(--accent-dim) disabled:opacity-50"
            >
              {t("picker.add_custom_port")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
