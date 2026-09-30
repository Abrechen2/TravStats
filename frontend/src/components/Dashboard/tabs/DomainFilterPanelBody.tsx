import type { JSX } from "react";
import { useRef } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainColors } from "../../../hooks/useDomainColors";
import type {
  DashboardDomainFilterResult,
  DomainFilterRow as DomainFilterRowData,
} from "../../../hooks/useDashboardDomainFilter";
import type { FilterDomainKey } from "../../../shared/dashboardDomainFilter";
import { DomainFilterRow } from "./DomainFilterRow";

export interface DomainFilterPanelBodyProps {
  filter: DashboardDomainFilterResult;
  phone: boolean;
  /** Finger-sized targets, independent of the sheet/dropdown choice. */
  touch: boolean;
  /** Row to focus once the panel/sheet mounts — the design's "Fokus auf erste Zeile". */
  autoFocusKey: FilterDomainKey | null;
  onEscape: () => void;
  onAdopted: () => void;
}

/** `tabStrip.tabs.*` already names all six — one label source, no duplicate copy. */
function rowLabel(t: (key: string) => string, key: FilterDomainKey): string {
  return t(`dashboard:tabStrip.tabs.${key}`);
}

/**
 * The filter's content, shared verbatim between the desktop dropdown and the
 * mobile sheet (`DomainFilterButton.tsx` supplies the differing outer chrome
 * and the `phone` flag). Owns arrow-key roving across the `role="checkbox"`
 * rows — decision: "↑↓ wandern, Leertaste hakt an, Esc schließt und
 * fokussiert den Knopf zurück" (Esc itself is handled one level up, via
 * `onEscape`, because closing also has to move focus back to the trigger
 * button, which this component does not hold a reference to).
 */
export function DomainFilterPanelBody({
  filter,
  phone,
  touch,
  autoFocusKey,
  onEscape,
  onAdopted,
}: DomainFilterPanelBodyProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const { colorOf } = useDomainColors();
  const rowRefs = useRef<Partial<Record<FilterDomainKey, HTMLDivElement | null>>>({});
  // The row ref below is an inline callback, so React re-runs it on EVERY
  // render. Focusing there unguarded pulled focus back to the first row after
  // each Space toggle (found in a browser, 2026-09-30). Focus once per mount.
  const autoFocusDone = useRef(false);

  const colorFor = (key: FilterDomainKey): string =>
    // Tours carry no `DomainKey` of their own (see shared/dashboardDomainFilter.ts) —
    // AllTab's own legend already resolves the tour swatch through the roadtrip
    // domain colour (one "road" hue since round 29); this mirrors that exactly.
    colorOf(key === "tour" ? "roadtrip" : key);

  const focusRow = (key: FilterDomainKey | undefined): void => {
    if (key === undefined) return;
    rowRefs.current[key]?.focus();
  };

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const currentKey = e.currentTarget.dataset.domainFilterRow as FilterDomainKey | undefined;
    const idx = filter.rows.findIndex((r) => r.key === currentKey);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (idx >= 0 && idx < filter.rows.length - 1) focusRow(filter.rows[idx + 1].key);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) focusRow(filter.rows[idx - 1].key);
    } else if (e.key === " " || e.key === "Spacebar" || e.key === "Enter") {
      e.preventDefault();
      if (currentKey) filter.toggle(currentKey);
    }
  };

  // Escape is caught on the panel root, not per row: after "Alle"/"Keine",
  // "Nur" or a link action the focus sits on a button, and a row-only handler
  // left Escape dead there (found in a browser, 2026-09-30).
  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    onEscape();
  };

  const onlyLabel = t("dashboard:domainFilter.row.only");
  const onlyTooltip = t("dashboard:domainFilter.row.onlyTooltip");
  const betaTooltip = t("dashboard:domainFilter.betaBadge.tooltip");

  const rowsList = (
    <div className="flex flex-col" style={{ gap: phone ? 2 : 1 }}>
      {filter.rows.map((row: DomainFilterRowData) => (
        <DomainFilterRow
          key={row.key}
          row={row}
          label={rowLabel(t, row.key)}
          color={colorFor(row.key)}
          onlyLabel={onlyLabel}
          onlyTooltip={onlyTooltip}
          betaTooltip={betaTooltip}
          touch={touch}
          onToggle={filter.toggle}
          onIsolate={filter.isolate}
          onKeyDown={handleRowKeyDown}
          rowRef={(el) => {
            rowRefs.current[row.key] = el;
            if (el && row.key === autoFocusKey && !autoFocusDone.current) {
              autoFocusDone.current = true;
              el.focus();
            }
          }}
        />
      ))}
    </div>
  );

  const quickActions = (
    <div className="flex items-center" style={{ gap: 12 }}>
      <button
        type="button"
        onClick={filter.showAll}
        className="cursor-pointer"
        style={{
          background: "none",
          border: "none",
          color: "var(--ts-accent)",
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        {t("dashboard:domainFilter.panel.all")}
      </button>
      <button
        type="button"
        onClick={filter.showNone}
        className="cursor-pointer"
        style={{
          background: "none",
          border: "none",
          color: "var(--ts-accent)",
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        {t("dashboard:domainFilter.panel.none")}
      </button>
    </div>
  );

  const linkBanner = filter.isLinkMode && (
    <div
      style={{
        border: "1px solid var(--ts-info)",
        borderRadius: 8,
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div className="flex items-center" style={{ gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--ts-info)",
            border: "1px solid var(--ts-info)",
            borderRadius: 999,
            padding: "1px 6px",
          }}
        >
          {t("dashboard:domainFilter.link.badge")}
        </span>
      </div>
      <span style={{ fontSize: 11.5, color: "var(--ts-muted)" }}>
        {t("dashboard:domainFilter.link.note")}
      </span>
      <div className="flex items-center" style={{ gap: 14 }}>
        <button
          type="button"
          onClick={() => {
            filter.adoptLink();
            onAdopted();
          }}
          className="cursor-pointer"
          style={{
            background: "none",
            border: "none",
            color: "var(--ts-accent)",
            fontSize: 12,
            fontWeight: 600,
            padding: 0,
          }}
        >
          {t("dashboard:domainFilter.link.adopt")}
        </button>
        <button
          type="button"
          onClick={filter.viewOwnSelection}
          className="cursor-pointer"
          style={{
            background: "none",
            border: "none",
            color: "var(--ts-muted)",
            fontSize: 12,
            fontWeight: 500,
            padding: 0,
          }}
        >
          {t("dashboard:domainFilter.link.mine")}
        </button>
      </div>
    </div>
  );

  const persistHint = (
    <div
      style={{ fontSize: 11, color: "var(--ts-muted)", padding: touch ? "8px 10px" : "6px 2px 0" }}
    >
      {t("dashboard:domainFilter.panel.persist")}
    </div>
  );

  if (phone) {
    return (
      <div className="flex flex-col" style={{ gap: 4 }} onKeyDown={handlePanelKeyDown}>
        {linkBanner}
        <div style={{ padding: "0 10px" }}>{quickActions}</div>
        {rowsList}
        {persistHint}
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 8 }} onKeyDown={handlePanelKeyDown}>
      <div className="flex items-center justify-between">
        <span className="t-label-mono">{t("dashboard:domainFilter.panel.title")}</span>
        {quickActions}
      </div>
      {linkBanner}
      {rowsList}
      {persistHint}
    </div>
  );
}
