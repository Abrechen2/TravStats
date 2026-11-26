import { useRef } from "react";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { Icon, type IconName } from "./Icon";
import type { JSX, KeyboardEvent, ReactNode } from "react";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** A count, drawn in mono next to the label. Omitted or null: nothing is drawn. */
  count?: number | string | null;
  /** A leading icon from the vendored set. */
  icon?: IconName;
  /** Hover text. */
  title?: string;
  /**
   * Drawn dimmed but still operable (an area that is switched off still has a
   * page that explains it). Sets `data-disabled` so a test can see the state.
   */
  dimmed?: boolean;
  /** Anything after the label and count (a gap marker, an icon). */
  extra?: ReactNode;
  /** Spoken name when it differs from the visible label. */
  name?: string;
  disabled?: boolean;
  testId?: string;
}

interface TabsProps<T extends string> {
  value: T;
  tabs: readonly TabItem<T>[];
  onChange: (value: T) => void;
  /** Names the set for a screen reader. */
  label: string;
  /**
   * `underline` is the page-level tab bar; `pill` is a compact switch inside a
   * dialog or a card (same look as the Segmented pills, but with the tab role,
   * because it switches a panel and not a value).
   */
  variant?: "underline" | "pill";
  /**
   * When set, tab and panel ids are `${idPrefix}-tab-${value}` and
   * `${idPrefix}-panel-${value}`, and the tab carries aria-controls.
   */
  idPrefix?: string;
  className?: string;
  /** Skip the rule under the bar, for a bar that sits inside a frame that draws its own. */
  borderless?: boolean;
}

export const tabId = (prefix: string, value: string): string => `${prefix}-tab-${value}`;
export const tabPanelId = (prefix: string, value: string): string => `${prefix}-panel-${value}`;

/**
 * A set of tabs. One implementation of the WAI-ARIA tabs pattern: a roving tab
 * stop, arrow keys / Home / End move the choice, and the chosen tab is the only
 * one a screen reader can Tab to. Eight hand-rolled sets each got a different
 * half of that right (ui-unify audit, 2026-11-26).
 */
export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  label,
  variant = "underline",
  idPrefix,
  className,
  borderless = false,
}: TabsProps<T>): JSX.Element {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const coarse = useCoarsePointer();
  const pill = variant === "pill";

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let step = 0;
    let target: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") step = 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") step = -1;
    else if (event.key === "Home") target = tabs.findIndex((tab) => !tab.disabled);
    else if (event.key === "End") {
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (!tabs[i].disabled) {
          target = i;
          break;
        }
      }
    } else return;
    event.preventDefault();
    if (target === null) {
      let next = index;
      for (let i = 0; i < tabs.length; i++) {
        next = (next + step + tabs.length) % tabs.length;
        if (!tabs[next].disabled) break;
      }
      target = next;
    }
    if (target < 0 || target === index || tabs[target].disabled) return;
    onChange(tabs[target].value);
    refs.current[target]?.focus();
  };

  const tabStop = tabs.some((tab) => tab.value === value && !tab.disabled)
    ? value
    : tabs.find((tab) => !tab.disabled)?.value;

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`${pill ? "flex flex-wrap" : "flex overflow-x-auto overflow-y-hidden scrollbar-none"}${className ? ` ${className}` : ""}`}
      style={
        pill
          ? { gap: "var(--ts-space-sm)" }
          : { borderBottom: borderless ? undefined : "1px solid var(--ts-border)", minWidth: 0 }
      }
    >
      {tabs.map((tab, index) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={idPrefix ? tabId(idPrefix, tab.value) : undefined}
            aria-selected={active}
            aria-controls={idPrefix ? tabPanelId(idPrefix, tab.value) : undefined}
            aria-label={tab.name}
            title={tab.title}
            data-disabled={tab.dimmed === undefined ? undefined : tab.dimmed ? "true" : "false"}
            tabIndex={tab.value === tabStop ? 0 : -1}
            disabled={tab.disabled}
            data-testid={tab.testId}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => move(event, index)}
            className={pill ? "ts-chip" : "flex shrink-0 items-center gap-2 whitespace-nowrap"}
            style={
              pill
                ? {
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--ts-space-sm)",
                    height: coarse ? undefined : 36,
                    minHeight: coarse ? "var(--ts-size-touch-min)" : undefined,
                    padding: "0 var(--ts-space-lg)",
                    borderRadius: "var(--ts-radius-pill)",
                    background: active ? "var(--ts-accent)" : "transparent",
                    color: active ? "var(--ts-accent-text)" : "var(--ts-text)",
                    border: `1px solid ${active ? "var(--ts-accent)" : "var(--ts-border-button)"}`,
                    fontSize: 13,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    opacity: tab.disabled ? 0.5 : 1,
                  }
                : {
                    padding: "0 var(--ts-space-xl)",
                    minHeight: coarse ? "var(--ts-size-touch-min)" : 44,
                    fontSize: 14,
                    fontWeight: active ? 700 : 500,
                    color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
                    boxShadow: `inset 0 -2px 0 ${active ? "var(--ts-accent)" : "transparent"}`,
                    opacity: tab.disabled ? 0.5 : tab.dimmed ? 0.55 : 1,
                  }
            }
          >
            {tab.icon ? <Icon name={tab.icon} size={16} /> : null}
            {tab.label}
            {tab.count !== undefined && tab.count !== null ? (
              <span
                className="t-caption"
                style={{
                  fontFamily: "var(--ts-font-mono)",
                  color: pill && active ? "var(--ts-accent-text)" : undefined,
                }}
              >
                {tab.count}
              </span>
            ) : null}
            {tab.extra}
          </button>
        );
      })}
    </div>
  );
}
