import type { JSX } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../../components/ui/Icon";
import { Select } from "../../components/ui/Field";
import { useTranslation } from "../../hooks/useTranslation";

export interface SettingsTab {
  id: string;
  label: string;
  to: string;
  active: boolean;
}

export interface SettingsIndexEntry {
  id: string;
  label: string;
  icon: IconName;
}

export interface SettingsIndexCategory {
  id: string;
  label: string;
  entries: SettingsIndexEntry[];
}

interface Props {
  tabs: SettingsTab[];
  categories: SettingsIndexCategory[];
  /** The section currently in view. */
  active: string | null;
  onJump: (section: string) => void;
}

/**
 * The left column of the settings page: the four routes as tabs, and under
 * them an index of every section on this route, grouped by kind.
 *
 * Round-4 export, "Einstellungen v3". It replaces a column of four group
 * names that led to four separate pages — the reader could not see what was
 * INSIDE a group without opening it. The index names every section, so the
 * page is scanned from the side, and the entry for what is on screen stays
 * marked while the page scrolls.
 *
 * Below `md` a 240px column would be the whole screen, so the same two lists
 * become tab pills and a jump menu, as the export's phone layout draws them.
 */
export function SettingsIndexCompact({ tabs, categories, active, onJump }: Props): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const all = categories.flatMap((category) => category.entries);
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {all.length > 1 && (
        <Select
          aria-label={t("settings:sectionPicker", { defaultValue: "Bereich" })}
          value={active ?? all[0]?.id ?? ""}
          onChange={(event) => onJump(event.target.value)}
          style={{ maxWidth: 260 }}
        >
          {categories.map((category) => (
            <optgroup key={category.id} label={category.label}>
              {category.entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      )}
      <nav
        aria-label={t("settings:title", { defaultValue: "Einstellungen" })}
        className="flex flex-wrap"
        style={{ gap: "var(--ts-space-sm)" }}
      >
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            to={tab.to}
            aria-current={tab.active ? "page" : undefined}
            className="ts-chip"
            // The chip recipe (components/ui/Chip): a route choice reads as a
            // choice among options, which is what the export draws here.
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 34,
              padding: "0 var(--ts-space-lg)",
              borderRadius: "var(--ts-radius-chip)",
              background: tab.active ? "var(--ts-accent)" : "transparent",
              color: tab.active ? "var(--ts-accent-text)" : "var(--ts-text)",
              border: `1px solid ${tab.active ? "var(--ts-accent)" : "var(--ts-border-button)"}`,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function SettingsIndexColumn({ tabs, categories, active, onJump }: Props): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <aside
      className="flex flex-col"
      style={{
        position: "sticky",
        top: "calc(var(--ts-size-web-header) + var(--ts-space-xl))",
        alignSelf: "start",
        maxHeight: "calc(100vh - var(--ts-size-web-header) - 2 * var(--ts-space-xl))",
        gap: "var(--ts-space-lg)",
      }}
    >
      <nav
        aria-label={t("settings:title", { defaultValue: "Einstellungen" })}
        className="flex overflow-x-auto scrollbar-none"
        style={{ borderBottom: "1px solid var(--ts-border)" }}
      >
        {/* Four routes (Allgemein, Flug, Kreuzfahrt, Unterkünfte) must fit the
            240px column: measured, their labels alone take ~200px at 13px, so
            at the old padding "Unterkünfte" was cut to "Un". The tabs share
            the width and keep a small inset instead. */}
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            to={tab.to}
            aria-current={tab.active ? "page" : undefined}
            className="whitespace-nowrap text-center"
            style={{
              flex: "1 1 auto",
              padding: "var(--ts-space-sm) 4px",
              fontSize: 12,
              fontWeight: tab.active ? 700 : 500,
              color: tab.active ? "var(--ts-text-bright)" : "var(--ts-muted)",
              boxShadow: `inset 0 -2px 0 ${tab.active ? "var(--ts-accent)" : "transparent"}`,
            }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <nav
        aria-label={t("settings:sectionPicker", { defaultValue: "Bereich" })}
        className="flex flex-col overflow-y-auto"
        style={{ gap: "var(--ts-space-lg)" }}
      >
        {categories.map((category) => (
          <div key={category.id} className="flex flex-col" style={{ gap: 2 }}>
            <span
              className="t-label-mono"
              style={{ padding: "0 var(--ts-space-md)", marginBottom: "var(--ts-space-xs)" }}
            >
              {category.label}
            </span>
            {category.entries.map((entry) => {
              const isActive = entry.id === active;
              return (
                <a
                  key={entry.id}
                  href={`#settings-${entry.id}`}
                  aria-current={isActive ? "location" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    onJump(entry.id);
                  }}
                  className="flex items-center"
                  style={{
                    gap: "var(--ts-space-sm)",
                    minHeight: 36,
                    padding: "0 var(--ts-space-md)",
                    borderRadius: "var(--ts-radius-button)",
                    fontSize: 14,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? "var(--ts-text-bright)" : "var(--ts-muted)",
                    background: isActive ? "var(--ts-tile)" : "transparent",
                  }}
                >
                  <Icon name={entry.icon} size={16} />
                  {entry.label}
                </a>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
