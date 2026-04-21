import { useState, useRef, useEffect } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { DashboardMode, DashboardTab } from "../../types/dashboard";
import { TAB_MODE_REGISTRY } from "../../types/dashboard";
import { AddDomainPicker } from "./AddDomainPicker";

type AddableDomain = "flight" | "cruise" | "poi";

interface DashboardControlsBarProps {
  tab: DashboardTab;
  mode: DashboardMode;
  enabledDomains: Record<AddableDomain, boolean>;
  onModeChange(next: DashboardMode): void;
  onFilterOpen(): void;
  onAdd(domain?: AddableDomain): void;
}

export function DashboardControlsBar({
  tab,
  mode,
  enabledDomains,
  onModeChange,
  onFilterOpen,
  onAdd,
}: DashboardControlsBarProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modeMenuOpen) return;
    const onClickOutside = (e: MouseEvent): void => {
      if (!modeRef.current?.contains(e.target as Node)) setModeMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [modeMenuOpen]);

  const modes = TAB_MODE_REGISTRY[tab].modes;

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        alignItems: "center",
        padding: "8px 16px",
        background: "var(--color-surface-muted)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {/* Mode dropdown */}
      <div ref={modeRef} style={{ position: "relative" }}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={modeMenuOpen}
          onClick={() => setModeMenuOpen((prev) => !prev)}
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            padding: "6px 12px",
            borderRadius: "10px",
            color: "var(--text-primary)",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          {t("dashboard:controls.mode")}: <strong>{t(`dashboard:modes.${mode}`)}</strong> {"\u25be"}
        </button>
        {modeMenuOpen && (
          <ul
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "10px",
              listStyle: "none",
              margin: 0,
              padding: "4px 0",
              minWidth: "200px",
              zIndex: 30,
            }}
          >
            {modes.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onModeChange(m as DashboardMode);
                    setModeMenuOpen(false);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 14px",
                    background: m === mode ? "var(--color-surface-muted)" : "transparent",
                    color: "var(--text-primary)",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                >
                  {t(`dashboard:modes.${m}`)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Filter button */}
      <button
        type="button"
        onClick={onFilterOpen}
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          padding: "6px 12px",
          borderRadius: "10px",
          color: "var(--text-primary)",
          fontSize: "13px",
          cursor: "pointer",
        }}
      >
        {t("dashboard:controls.filter")} {"\u25be"}
      </button>

      {/* Add action — domain-specific button or universal picker */}
      <div style={{ marginLeft: "auto" }}>
        {tab === "all" ? (
          <AddDomainPicker enabled={enabledDomains} onPick={(domain) => onAdd(domain)} />
        ) : (
          <button
            type="button"
            onClick={() => onAdd()}
            style={{
              background: "var(--accent)",
              color: "#0d1117",
              padding: "6px 12px",
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
          >
            + {t(`dashboard:controls.addPerTab.${tab}`)}
          </button>
        )}
      </div>
    </div>
  );
}
