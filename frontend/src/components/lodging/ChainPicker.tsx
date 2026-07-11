import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { listChains, createChain } from "../../lib/api/lodging";
import { logger } from "../../lib/logger";
import type { LodgingChain } from "../../types/lodging";

interface ChainPickerProps {
  value: LodgingChain | null;
  onChange: (chain: LodgingChain | null) => void;
}

/**
 * Searchable select over the shared chain catalog (`listChains`), with an
 * "add a chain that's missing" flow via `createChain`.
 *
 * The backend matches chain names CASE-INSENSITIVELY when adding (see
 * `routes/lodgingChains.ts`) — typing "hilton" when "Hilton" already exists
 * returns the EXISTING catalog row (200) instead of creating a duplicate.
 * A returned name that differs from what was typed (any case difference)
 * means an existing entry was matched, not created — `matchedNotice` makes
 * that explicit so the user never walks away believing they just added a
 * duplicate chain.
 */
export function ChainPicker({ value, onChange }: ChainPickerProps): JSX.Element {
  const { t } = useTranslation(["lodging", "common"]);
  const [query, setQuery] = useState<string>(value?.name ?? "");
  const [results, setResults] = useState<LodgingChain[]>([]);
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [matchedNotice, setMatchedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2 || query === value?.name) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const r = await listChains(query.trim());
          if (!cancelled) setResults(r);
        } catch (err: unknown) {
          logger.warn("ChainPicker: search failed", err);
          if (!cancelled) setResults([]);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, value?.name]);

  const trimmedQuery = query.trim();
  const exactMatch = results.some((r) => r.name.toLowerCase() === trimmedQuery.toLowerCase());

  const handleSelect = (chain: LodgingChain): void => {
    onChange(chain);
    setQuery(chain.name);
    setResults([]);
    setMatchedNotice(null);
  };

  const handleClear = (): void => {
    onChange(null);
    setQuery("");
    setResults([]);
    setMatchedNotice(null);
  };

  const handleAdd = async (): Promise<void> => {
    if (trimmedQuery.length === 0) return;
    setSaving(true);
    setError(null);
    setMatchedNotice(null);
    try {
      const chain = await createChain({ name: trimmedQuery });
      if (chain.name !== trimmedQuery) {
        setMatchedNotice(t("lodging:chainPicker.matchedExisting", { name: chain.name }));
      }
      onChange(chain);
      setQuery(chain.name);
      setShowAdd(false);
    } catch (err: unknown) {
      logger.error("ChainPicker: create failed", err);
      setError(t("lodging:chainPicker.addError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          role="combobox"
          aria-expanded={results.length > 0}
          aria-autocomplete="list"
          aria-label={t("lodging:field.chain")}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          placeholder={t("lodging:chainPicker.placeholder")}
          value={query}
          onChange={(e): void => {
            setQuery(e.target.value);
            setMatchedNotice(null);
          }}
        />
        {value !== null && (
          <button
            type="button"
            onClick={handleClear}
            className="whitespace-nowrap text-xs text-[var(--text-muted)] hover:underline"
          >
            {t("lodging:chainPicker.clear")}
          </button>
        )}
      </div>

      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] shadow-lg">
          {results.map((chain) => (
            <li key={chain.id}>
              <button
                type="button"
                onClick={(): void => handleSelect(chain)}
                className="w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
              >
                {chain.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {trimmedQuery.length >= 2 && query !== value?.name && !exactMatch && !showAdd && (
        <button
          type="button"
          onClick={(): void => setShowAdd(true)}
          className="mt-2 text-xs text-[var(--accent)] hover:underline"
        >
          {t("lodging:chainPicker.addMissing", { name: trimmedQuery })}
        </button>
      )}

      {showAdd && (
        <div className="mt-2 space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-3">
          <p className="text-xs text-[var(--text-muted)]">
            {t("lodging:chainPicker.confirmAdd", { name: trimmedQuery })}
          </p>
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
              {t("common:buttons.cancel")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={(): void => {
                void handleAdd();
              }}
              className="rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-neutral-900 hover:bg-[var(--accent-dim)] disabled:opacity-50"
            >
              {saving ? t("common:buttons.saving") : t("lodging:chainPicker.addMissing", { name: trimmedQuery })}
            </button>
          </div>
        </div>
      )}

      {matchedNotice !== null && (
        <p data-testid="chain-matched-existing" className="mt-2 text-xs text-[var(--text-muted)]">
          {matchedNotice}
        </p>
      )}
    </div>
  );
}
