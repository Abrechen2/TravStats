import { useId, useMemo, useState, type JSX, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Input } from "../../../components/ui/Field";
import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useBetaFeatures } from "../../../hooks/useBetaFeatures";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { SETTINGS_REGISTRY, type RegistryAccess } from "../registry";
import { searchArea, type AreaSearchHit, type SearchLanguage } from "./areaSearch";

/** How many hits the list shows; the count line says how many there are. */
export const MAX_HITS = 8;

/**
 * The search box above the settings menu (owner request 2026-09-24, rebuilt on
 * the registry in the settings rebuild). It searches every row of every page
 * the account can reach — the expert rows too, because a person looking for
 * "Abfrageintervall" at the standard level must learn that it exists and where.
 * A hit on an expert row says so, and opening it shows that row for this visit
 * without changing the saved level (`?expert=1`).
 */
export function AreaSearch({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const { t, i18n } = useTranslation(["settings"]);
  const navigate = useNavigate();
  const coarse = useCoarsePointer();
  const { isEnabled } = useEnabledDomains();
  const { isFeatureVisible } = useBetaFeatures();
  const [query, setQuery] = useState("");
  const listId = useId();
  const lang: SearchLanguage = i18n.language?.startsWith("en") ? "en" : "de";

  const access = useMemo<RegistryAccess>(
    () => ({ isAdmin, isDomainOn: isEnabled, isGateOpen: isFeatureVisible }),
    [isAdmin, isEnabled, isFeatureVisible]
  );
  const result = useMemo(
    () => searchArea(query, SETTINGS_REGISTRY, access, lang),
    [query, access, lang]
  );
  const shown = result.hits.slice(0, MAX_HITS);
  const searching = query.trim().length >= 2;

  const open = (hit: AreaSearchHit): void => {
    navigate(hit.href, { state: { highlight: hit.highlight } });
    setQuery("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") setQuery("");
    if (event.key === "Enter" && shown.length > 0) {
      event.preventDefault();
      open(shown[0]);
    }
  };

  return (
    <div role="search" className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t("settings:search.placeholder")}
        aria-label={t("settings:search.label")}
        aria-controls={searching ? listId : undefined}
      />
      {searching && (
        <div
          id={listId}
          className="flex flex-col"
          style={{
            gap: 2,
            padding: "var(--ts-space-xs)",
            borderRadius: "var(--ts-radius-card)",
            border: "1px solid var(--ts-border)",
            background: "var(--ts-surface2)",
          }}
        >
          {shown.length === 0 ? (
            <p role="status" className="t-caption" style={{ padding: "var(--ts-space-sm)" }}>
              {t("settings:search.noResultsFor", { query: query.trim() })}
            </p>
          ) : (
            <>
              <p
                role="status"
                data-testid="settings-search-count"
                className="t-caption"
                style={{ padding: "var(--ts-space-xs) var(--ts-space-md)" }}
              >
                {result.hits.length > MAX_HITS
                  ? t("settings:search.countMore", {
                      shown: MAX_HITS,
                      count: result.hits.length,
                    })
                  : t("settings:search.count", { count: result.hits.length })}
              </p>
              <ul aria-label={t("settings:search.results")} className="flex flex-col">
                {shown.map((hit) => (
                  <li key={hit.key} className="flex flex-col">
                    <Link
                      to={hit.href}
                      state={{ highlight: hit.highlight }}
                      onClick={(event) => {
                        // A modified click opens a new tab, as any link does.
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                          return;
                        event.preventDefault();
                        open(hit);
                      }}
                      className="flex flex-col"
                      style={{
                        padding: "var(--ts-space-sm) var(--ts-space-md)",
                        borderRadius: "var(--ts-radius-button)",
                        minHeight: coarse ? "var(--ts-size-touch-min)" : undefined,
                      }}
                    >
                      <span
                        style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}
                      >
                        {hit.label}
                      </span>
                      <span className="t-caption" style={{ color: "var(--ts-muted)" }}>
                        {t("settings:title")} › {hit.where}
                        {hit.expertOnly ? ` · ${t("settings:level.expert")}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {shown.some((h) => h.expertOnly) && (
                <p
                  className="t-caption"
                  style={{ padding: "var(--ts-space-xs) var(--ts-space-md)" }}
                >
                  {t("settings:search.expertNote")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
