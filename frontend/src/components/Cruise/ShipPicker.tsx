import { useEffect, useId, useState } from "react";
import { shipsApi } from "../../lib/api";
import type { Ship } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

interface Props {
  value: Ship | null;
  onChange: (ship: Ship) => void;
  /** Visible name of the search field (forgejo#249: the placeholder was its only name). */
  label?: string;
  /** Id of the search field, so a "still needed" hint can take focus to it. */
  id?: string;
}

/**
 * Combobox-style ship picker.
 *
 * - Debounced (250ms) search against `shipsApi.search`.
 * - Shows a dropdown with matches from the catalog.
 * - Offers an "add custom" flow when no exact-name match is present in results,
 *   creating a new user-added ship via `shipsApi.create`.
 * - A failed search SAYS so. It used to show an empty list, which offered
 *   "add ship" for a ship the catalogue had, and every such add wrote a
 *   duplicate into the catalogue all accounts share. The server now also
 *   answers a duplicate create with the existing ship; that is said too.
 */
export function ShipPicker({ value, onChange, label, id }: Props): JSX.Element {
  const { t } = useTranslation("cruise");
  const generatedId = useId();
  const inputId = id ?? `ship-picker-${generatedId}`;
  const [query, setQuery] = useState<string>(value?.name ?? "");
  const [results, setResults] = useState<Ship[]>([]);
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [newLine, setNewLine] = useState<string>("");
  const [newRiver, setNewRiver] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Don't search when the field merely shows the already-selected ship —
    // otherwise the dropdown re-opens right after a pick and on modal open.
    if (!query || query.length < 2 || query === value?.name) {
      setResults([]);
      setSearchError(false);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const r = await shipsApi.search(query);
        if (cancelled) return;
        setResults(Array.isArray(r) ? r : []);
        setSearchError(false);
      } catch {
        if (cancelled) return;
        setResults([]);
        setSearchError(true);
      }
    }, 250);
    return (): void => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, value?.name]);

  const exactMatch = results.some((r) => r.name.toLowerCase() === query.toLowerCase());

  const handleSelect = (ship: Ship): void => {
    onChange(ship);
    setQuery(ship.name);
    setResults([]);
    setNotice(null);
  };

  const save = async (): Promise<void> => {
    if (!newName || !newLine) return;
    setSaving(true);
    setError(null);
    try {
      const { ship, existing } = await shipsApi.create({
        name: newName,
        cruiseLine: newLine,
        kind: newRiver ? "river" : "ocean",
      });
      onChange(ship);
      setNotice(existing ? t("picker.shipAlreadyExists", { name: ship.name }) : null);
      setQuery(ship.name);
      setResults([]);
      setShowAdd(false);
      setNewName("");
      setNewLine("");
      setNewRiver(false);
    } catch {
      setError(t("picker.createShipError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      {label !== undefined && (
        <label htmlFor={inputId} className="mb-1 block text-xs text-(--text-muted)">
          {label}
        </label>
      )}
      <input
        id={inputId}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-autocomplete="list"
        className="w-full rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-hidden pointer-coarse:min-h-(--ts-size-touch-min)"
        placeholder={t("picker.ship_placeholder")}
        value={query}
        onChange={(e): void => setQuery(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-(--bg-surface) shadow-lg">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-(--text-primary) hover:bg-(--bg-elevated) pointer-coarse:min-h-(--ts-size-touch-min)"
                onClick={(): void => handleSelect(r)}
              >
                {r.name} <span className="text-(--text-muted)">— {r.cruiseLine}</span>
                {r.kind === "river" && (
                  <span className="ml-2 text-xs text-(--text-muted)">· {t("picker.riverTag")}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {searchError && (
        <p role="alert" className="mt-1 text-xs text-(--danger)">
          {t("picker.shipSearchError")}
        </p>
      )}
      {notice !== null && (
        <p role="status" className="mt-1 text-xs text-(--text-muted)">
          {notice}
        </p>
      )}
      {query.length >= 2 && query !== value?.name && !exactMatch && !searchError && !showAdd && (
        <button
          type="button"
          className="mt-2 text-xs text-(--accent) hover:underline"
          onClick={(): void => {
            setNewName(query);
            setShowAdd(true);
          }}
        >
          {t("picker.add_custom_ship")}
        </button>
      )}
      {showAdd && (
        <div className="mt-2 space-y-2 rounded-md border border-border bg-(--bg-surface) p-3">
          <input
            className="w-full rounded-md border border-border bg-(--bg-elevated) px-2 py-1 text-sm text-(--text-primary) placeholder:text-(--text-muted)"
            value={newName}
            onChange={(e): void => setNewName(e.target.value)}
            placeholder={t("field.ship")}
          />
          <input
            className="w-full rounded-md border border-border bg-(--bg-elevated) px-2 py-1 text-sm text-(--text-primary) placeholder:text-(--text-muted)"
            value={newLine}
            onChange={(e): void => setNewLine(e.target.value)}
            placeholder={t("field.line")}
          />
          <label className="flex items-center gap-2 text-xs text-(--text-primary)">
            <input
              type="checkbox"
              checked={newRiver}
              onChange={(e): void => setNewRiver(e.target.checked)}
            />
            {t("picker.riverShip")}
          </label>
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
              disabled={saving || !newName || !newLine}
              onClick={(): void => {
                void save();
              }}
              className="rounded-md bg-(--accent) px-2 py-1 text-xs font-medium text-neutral-900 hover:bg-(--accent-dim) disabled:opacity-50"
            >
              {t("picker.add_custom_ship")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
