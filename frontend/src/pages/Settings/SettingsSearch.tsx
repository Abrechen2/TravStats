import { useId, useMemo, useState, type JSX, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Input } from "../../components/ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useEffectiveSettingsLevel, useSettingsLevelStore } from "../../store/settingsLevelStore";
import {
  searchSettings,
  splitKeywords,
  type SettingsSearchCandidate,
  type SettingsSearchHit,
} from "./settingsSearchMatch";

/** A section as the search sees it: where its words are, and its level. */
export interface SearchableSection {
  id: string;
  labelKey: string;
  /** `<ns>:search.keywords.<id>` — comma-separated, DE and EN. */
  keywordsKey: string;
  /** `<ns>:search.expertKeywords.<id>` — words for rows only the expert level shows. */
  expertKeywordsKey?: string;
  expert: boolean;
  /** Rows sit in collapsed groups; a hit names the row with `&match=`. */
  foldsRows?: boolean;
}

/** One page of settings, with the sections this account can see on it. */
export interface SettingsSearchScope {
  /** The page's address: "/settings/account", "/admin/instance". */
  path: string;
  label: string;
  sections: readonly SearchableSection[];
}

interface Props {
  scopes: readonly SettingsSearchScope[];
}

const MAX_HITS = 8;

/** `&expert=1` names the section's hidden rows, so the page shows them. */
function hrefOf(path: string, section: string, expertRows: boolean): string {
  return `${path}?section=${section}${expertRows ? "&expert=1" : ""}`;
}

/**
 * The search box above the settings menu (owner request 2026-09-24).
 *
 * It searches every page — personal settings and, for an admin, the
 * administration — not only the one on screen, and it searches what the
 * current level hides as well: a person looking for "Abfrageintervall" at the
 * standard level must learn that it exists and where, not that it does not.
 * Such a hit says it belongs to the expert view and offers the switch; its
 * link alone already opens the section, which a named link always shows.
 */
export function SettingsSearch({ scopes }: Props): JSX.Element {
  const { t } = useTranslation(["settings", "admin"]);
  const navigate = useNavigate();
  const level = useEffectiveSettingsLevel();
  const setLevel = useSettingsLevelStore((s) => s.setLevel);
  const coarse = useCoarsePointer();
  const [query, setQuery] = useState("");
  const listId = useId();

  const candidates = useMemo<SettingsSearchCandidate[]>(
    () =>
      scopes.flatMap((scope) =>
        scope.sections.map((section) => ({
          section: section.id,
          label: t(section.labelKey),
          groupLabel: scope.label,
          href: hrefOf(scope.path, section.id, false),
          keywords: splitKeywords(t(section.keywordsKey, { defaultValue: "" })),
          expertKeywords: section.expertKeywordsKey
            ? splitKeywords(t(section.expertKeywordsKey, { defaultValue: "" }))
            : [],
          expert: section.expert,
          foldsRows: section.foldsRows,
        }))
      ),
    [scopes, t]
  );

  // A hit on an expert row of a standard section links with `&expert=1`; a
  // whole expert section is shown by being named already.
  const hits = useMemo(
    () =>
      searchSettings(query, candidates)
        .slice(0, MAX_HITS)
        .map((hit) => {
          const expertRows = hit.expertOnly && !hit.expert ? "&expert=1" : "";
          // The matched word names the row inside the section, so a section
          // that folds its rows (the services accordion) can open the right one.
          const match =
            hit.foldsRows && hit.matchedKeyword
              ? `&match=${encodeURIComponent(hit.matchedKeyword)}`
              : "";
          return { ...hit, href: `${hit.href}${match}${expertRows}` };
        }),
    [query, candidates]
  );
  const searching = query.trim().length >= 2;

  const open = (hit: SettingsSearchHit, switchLevel: boolean): void => {
    if (switchLevel) setLevel("expert");
    navigate(hit.href);
    setQuery("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") setQuery("");
    if (event.key === "Enter" && hits.length > 0) {
      event.preventDefault();
      open(hits[0], false);
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
              {hits.map((hit) => {
                const offerSwitch = hit.expertOnly && level === "standard";
                return (
                  <li key={hit.href} className="flex flex-col">
                    <Link
                      to={hit.href}
                      onClick={() => setQuery("")}
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
                        {hit.groupLabel}
                        {hit.matchedKeyword ? ` · ${hit.matchedKeyword}` : ""}
                        {hit.expertOnly ? ` · ${t("settings:search.expertOnly")}` : ""}
                      </span>
                    </Link>
                    {offerSwitch && (
                      <button
                        type="button"
                        onClick={() => open(hit, true)}
                        className="t-caption self-start underline"
                        style={{
                          color: "var(--ts-accent)",
                          fontWeight: 600,
                          padding: "0 var(--ts-space-md) var(--ts-space-sm)",
                          minHeight: coarse ? "var(--ts-size-touch-min)" : undefined,
                        }}
                      >
                        {t("settings:search.switchAndOpen")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
