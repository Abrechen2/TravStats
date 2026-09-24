import { useId, useMemo, useState, type JSX, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Input } from "../../components/ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import {
  searchSettings,
  splitKeywords,
  type SettingsSearchCandidate,
  type SettingsSearchHit,
} from "./settingsSearchMatch";
import type { SettingsSectionId } from "./settingsModel";
import { SECTION_LABEL_KEY } from "./sectionLabels";

/** One page of settings, with the sections this account can see on it. */
export interface SettingsSearchScope {
  route: string;
  label: string;
  sections: readonly SettingsSectionId[];
}

interface Props {
  scopes: readonly SettingsSearchScope[];
}

const MAX_HITS = 8;

function hrefOf(hit: SettingsSearchHit): string {
  return `/settings/${hit.route}?section=${hit.section}`;
}

/**
 * The search box above the settings index (owner request 2026-09-24).
 *
 * It searches every page of settings, not only the one on screen: a person
 * looking for "Immich" on the flight page should not first have to guess that
 * it lives under Allgemein. A hit is a link to the section, and the page's own
 * deep-link handling scrolls it into view.
 */
export function SettingsSearch({ scopes }: Props): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const listId = useId();

  const candidates = useMemo<SettingsSearchCandidate[]>(
    () =>
      scopes.flatMap((scope) =>
        scope.sections.map((section) => ({
          section,
          label: t(SECTION_LABEL_KEY[section]),
          groupLabel: scope.label,
          route: scope.route,
          keywords: splitKeywords(t(`settings:search.keywords.${section}`, { defaultValue: "" })),
        }))
      ),
    [scopes, t]
  );

  const hits = useMemo(
    () => searchSettings(query, candidates).slice(0, MAX_HITS),
    [query, candidates]
  );
  const searching = query.trim().length >= 2;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") setQuery("");
    if (event.key === "Enter" && hits.length > 0) {
      event.preventDefault();
      navigate(hrefOf(hits[0]));
      setQuery("");
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
          {hits.length === 0 ? (
            <p role="status" className="t-caption" style={{ padding: "var(--ts-space-sm)" }}>
              {t("settings:search.noResults")}
            </p>
          ) : (
            <ul aria-label={t("settings:search.results")} className="flex flex-col">
              {hits.map((hit) => (
                <li key={`${hit.route}-${hit.section}`}>
                  <Link
                    to={hrefOf(hit)}
                    onClick={() => setQuery("")}
                    className="flex flex-col"
                    style={{
                      padding: "var(--ts-space-sm) var(--ts-space-md)",
                      borderRadius: "var(--ts-radius-button)",
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}>
                      {hit.label}
                    </span>
                    <span className="t-caption" style={{ color: "var(--ts-muted)" }}>
                      {hit.groupLabel}
                      {hit.matchedKeyword ? ` · ${hit.matchedKeyword}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
