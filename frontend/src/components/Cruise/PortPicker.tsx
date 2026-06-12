import { useEffect, useState } from "react";
import { portsApi } from "../../lib/api";
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
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const r = await portsApi.search(query);
        setResults(Array.isArray(r) ? r : []);
      } catch {
        setResults([]);
      }
    }, 250);
    return (): void => clearTimeout(handle);
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
        <span className="mb-1 block text-xs text-[var(--text-muted)]">{label}</span>
      )}
      <input
        role="combobox"
        aria-expanded={results.length > 0}
        aria-autocomplete="list"
        aria-label={label ?? t("picker.port_placeholder")}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        placeholder={t("picker.port_placeholder")}
        value={query}
        onChange={(e): void => setQuery(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] shadow-lg">
          {results.map((r) => {
            const location = formatLocation(r);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                  onClick={(): void => handleSelect(r)}
                >
                  {r.name}
                  {location && <span className="text-[var(--text-muted)]"> — {location}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {query.length >= 2 && query !== value?.name && !exactMatch && !showAdd && (
        <button
          type="button"
          className="mt-2 text-xs text-[var(--accent)] hover:underline"
          onClick={(): void => {
            setNewName(query);
            setShowAdd(true);
          }}
        >
          {t("picker.add_custom_port")}
        </button>
      )}
      {showAdd && (
        <div className="mt-2 space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-3">
          <input
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            value={newName}
            onChange={(e): void => setNewName(e.target.value)}
            placeholder={t("field.port_name")}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              value={newCity}
              onChange={(e): void => setNewCity(e.target.value)}
              placeholder={t("field.city")}
            />
            <input
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
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
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              value={newLat}
              onChange={(e): void => setNewLat(e.target.value)}
              placeholder={t("field.lat")}
            />
            <input
              type="number"
              step="0.001"
              min={-180}
              max={180}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              value={newLon}
              onChange={(e): void => setNewLon(e.target.value)}
              placeholder={t("field.lon")}
            />
          </div>
          {error !== null && <p className="text-xs text-[var(--danger)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={(): void => {
                setShowAdd(false);
                setError(null);
              }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {t("picker.cancel")}
            </button>
            <button
              type="button"
              disabled={saving || !canSave}
              onClick={(): void => {
                void save();
              }}
              className="rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-neutral-900 hover:bg-[var(--accent-dim)] disabled:opacity-50"
            >
              {t("picker.add_custom_port")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
