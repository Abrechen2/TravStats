import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useGuardedNavigate } from "../../ui/settings/leaveGuard";
import { Icon, type IconName } from "../../ui/Icon";
import { Select } from "../../ui/Field";
import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { ExpertNote } from "./ExpertNote";

export interface SettingsMenuEntry {
  id: string;
  label: string;
  to: string;
  icon: IconName;
  /** A count beside the entry, e.g. the number of accounts. */
  badge?: number;
  /** A domain page's colour, as a dot — always from the domain colour store. */
  color?: string;
  /** Drawn under the entry above it (Flüge and Kreuzfahrten under Reisearten). */
  indent?: boolean;
  /** B15: something required on this page is missing; the dot carries `warnLabel`. */
  warn?: { label: string };
  /**
   * Readiness (owner, 2026-11-23): the entry glows amber or red and carries the
   * count of items that need attention.
   */
  attention?: { color: string; tone: string; count: number; label: string };
}

export interface SettingsMenuGroup {
  id: string;
  /** null draws the group without a heading. */
  label: string | null;
  entries: SettingsMenuEntry[];
}

interface Props {
  /** The navigation landmark's name: "Einstellungen", "Administration". */
  label: string;
  groups: SettingsMenuGroup[];
  activeId: string;
  /** Pages the standard level keeps out of the menu. */
  hiddenPages: number;
  search: ReactNode;
  /** Under the search: the Standard | Experte switch with its count. */
  levelSwitch?: ReactNode;
  /** Under the menu: the version line. */
  footer?: ReactNode;
}

/**
 * The left menu of the settings and admin surfaces (forgejo#321): one entry
 * per page, grouped, and sticky — it stays in view however long the page is
 * (tester, 2026-10-20). Only the entry list scrolls inside it, should a short
 * window not fit the whole menu.
 */
export function SettingsMenuColumn({
  label,
  groups,
  activeId,
  hiddenPages,
  search,
  levelSwitch,
  footer,
}: Props): JSX.Element {
  const coarse = useCoarsePointer();
  return (
    <aside
      data-settings-menu="sticky"
      className="flex flex-col"
      style={{
        position: "sticky",
        top: "calc(var(--ts-size-web-header) + var(--ts-space-xl))",
        alignSelf: "start",
        maxHeight: "calc(100vh - var(--ts-size-web-header) - 2 * var(--ts-space-xl))",
        gap: "var(--ts-space-lg)",
      }}
    >
      {search}
      {levelSwitch}
      <nav aria-label={label} className="flex flex-col overflow-y-auto" style={{ gap: 2 }}>
        {groups.map((group, index) => (
          <div
            key={group.id}
            className="flex flex-col"
            style={{
              gap: 2,
              paddingTop: index > 0 ? "var(--ts-space-md)" : undefined,
              borderTop: index > 0 && !group.label ? "1px solid var(--ts-border)" : undefined,
              marginTop: index > 0 && !group.label ? "var(--ts-space-sm)" : undefined,
            }}
          >
            {group.label && (
              // 11 px muted mono read as a footnote next to 14 px entries (tester,
              // 2026-11-18): one step larger and brighter, still a label, not an entry.
              <span
                className="t-label-mono"
                style={{
                  padding: "0 var(--ts-space-lg)",
                  marginBottom: "var(--ts-space-xs)",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  color: "var(--ts-text)",
                }}
              >
                {group.label}
              </span>
            )}
            {group.entries.map((entry) => {
              const active = entry.id === activeId;
              const glow = entry.attention;
              return (
                <Link
                  key={entry.id}
                  to={entry.to}
                  aria-current={active ? "page" : undefined}
                  data-attention={glow?.tone}
                  className="flex items-center"
                  style={{
                    gap: "var(--ts-space-md)",
                    minHeight: coarse ? "var(--ts-size-touch-min)" : 36,
                    // At 10 px the icon sat on the highlight's rounded edge (tester, 2026-11-18).
                    padding: "0 var(--ts-space-lg)",
                    paddingLeft: entry.indent ? 24 : "var(--ts-space-lg)",
                    borderRadius: "var(--ts-radius-button)",
                    fontSize: 14,
                    fontWeight: active ? 700 : 500,
                    color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
                    background: active ? "var(--ts-tile)" : "transparent",
                    ...(glow
                      ? {
                          boxShadow: `inset 3px 0 0 ${glow.color}, 0 0 12px -4px ${glow.color}`,
                          color: active ? "var(--ts-text-bright)" : glow.color,
                        }
                      : {}),
                  }}
                >
                  <Icon name={entry.icon} size={16} />
                  <span className="flex-1">{entry.label}</span>
                  {entry.color && (
                    <span
                      aria-hidden="true"
                      data-domain-dot=""
                      style={{
                        width: 8,
                        height: 8,
                        flexShrink: 0,
                        borderRadius: "var(--ts-radius-pill)",
                        background: entry.color,
                      }}
                    />
                  )}
                  {entry.warn && (
                    <span
                      role="img"
                      aria-label={entry.warn.label}
                      data-warn-dot=""
                      style={{
                        width: 8,
                        height: 8,
                        flexShrink: 0,
                        borderRadius: "var(--ts-radius-pill)",
                        background: "var(--ts-warn)",
                      }}
                    />
                  )}
                  {glow && (
                    <span
                      role="img"
                      aria-label={glow.label}
                      data-attention-badge=""
                      className="inline-flex items-center justify-center"
                      style={{
                        minWidth: 20,
                        height: 20,
                        padding: "0 6px",
                        borderRadius: "var(--ts-radius-pill)",
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--ts-bg)",
                        background: glow.color,
                      }}
                    >
                      {glow.count}
                    </span>
                  )}
                  {entry.badge !== undefined && (
                    <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                      {entry.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <ExpertNote count={hiddenPages} kind="pages" />
      {footer}
    </aside>
  );
}

/**
 * Below `md` a 240px column would be the whole screen: the same menu becomes a
 * page picker under the search.
 */
export function SettingsMenuCompact({
  label,
  groups,
  activeId,
  hiddenPages,
  search,
  levelSwitch,
}: Props): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const navigate = useGuardedNavigate();
  const entries = groups.flatMap((g) => g.entries);
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {search}
      {levelSwitch}
      <Select
        aria-label={t("settings:pagePicker")}
        value={activeId}
        onChange={(event) => {
          const target = entries.find((e) => e.id === event.target.value);
          if (target) navigate(target.to);
        }}
      >
        {groups.map((group) => (
          <optgroup key={group.id} label={group.label ?? label}>
            {group.entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.attention ? `${entry.label} (${entry.attention.count})` : entry.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <ExpertNote count={hiddenPages} kind="pages" />
    </div>
  );
}
