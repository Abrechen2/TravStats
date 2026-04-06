import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { VisMode } from "../types/visMode";
import { useTranslation } from "../hooks/useTranslation";

function RoutesIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 12 C5 2, 11 2, 14 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="2" cy="12" r="1.5" fill="currentColor" />
      <circle cx="14" cy="6" r="1.5" fill="currentColor" />
    </svg>
  );
}

function GlobeIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="8" cy="8" rx="3" ry="6" stroke="currentColor" strokeWidth="1" />
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function HeatmapIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}

function HexagonIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2 L13.2 5 L13.2 11 L8 14 L2.8 11 L2.8 5 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ColumnsIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="9" width="3.5" height="5.5" rx="0.5" opacity="0.5" />
      <rect x="6.25" y="5.5" width="3.5" height="9" rx="0.5" opacity="0.75" />
      <rect x="11" y="2" width="3.5" height="12.5" rx="0.5" />
    </svg>
  );
}

function TripsIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 8 Q5 3 8 8 Q11 13 14 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="14" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

function ContourIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <ellipse cx="8" cy="9" rx="6" ry="3.5" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <ellipse
        cx="8"
        cy="8.5"
        rx="4"
        ry="2.2"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.6"
      />
      <ellipse
        cx="8"
        cy="8"
        rx="2.2"
        ry="1.2"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.85"
      />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" />
    </svg>
  );
}

function TripRoutesIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 13 C5 3, 11 3, 14 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.9"
      />
      <path
        d="M2 10 C5 5, 11 5, 14 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      <circle cx="2" cy="13" r="1.2" fill="currentColor" />
      <circle cx="14" cy="7" r="1.2" fill="currentColor" />
    </svg>
  );
}

function PlusIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <line
        x1="8"
        y1="2"
        x2="8"
        y2="14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="2"
        y1="8"
        x2="14"
        y2="8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const MODE_ICONS: Record<VisMode, () => JSX.Element> = {
  routes: RoutesIcon,
  globe: GlobeIcon,
  heatmap: HeatmapIcon,
  hexagon: HexagonIcon,
  columns: ColumnsIcon,
  trips: TripsIcon,
  contour: ContourIcon,
  "trip-routes": TripRoutesIcon,
};

const MODES: { mode: VisMode; labelKey: string }[] = [
  { mode: "routes", labelKey: "map:visMode.routes" },
  { mode: "globe", labelKey: "map:visMode.globe" },
  { mode: "heatmap", labelKey: "map:visMode.heatmap" },
  { mode: "hexagon", labelKey: "map:visMode.hexagon" },
  { mode: "columns", labelKey: "map:visMode.columns" },
  { mode: "trips", labelKey: "map:visMode.trips" },
  { mode: "contour", labelKey: "map:visMode.contour" },
  { mode: "trip-routes", labelKey: "map:visMode.tripRoutes" },
];

interface VisModeSeelctorProps {
  current: VisMode;
  onChange: (mode: VisMode) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VisModeSelector({
  current,
  onChange,
  isOpen,
  onOpenChange,
}: VisModeSeelctorProps): JSX.Element {
  const { t } = useTranslation("map");

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onOpenChange(false);
    },
    [isOpen, onOpenChange]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleModeClick = useCallback(
    (mode: VisMode) => {
      onChange(mode);
      onOpenChange(false);
    },
    [onChange, onOpenChange]
  );

  const ActiveIcon = MODE_ICONS[current];

  return (
    <div className="relative flex flex-col items-end gap-1.5">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-end gap-1.5"
          >
            {[...MODES].reverse().map(({ mode, labelKey }) => {
              const active = current === mode;
              const Icon = MODE_ICONS[mode];
              return (
                <button
                  key={mode}
                  aria-label={t(labelKey)}
                  aria-pressed={active}
                  onClick={() => handleModeClick(mode)}
                  className="flex items-center gap-2 cursor-pointer border-none p-0 bg-transparent"
                >
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: "6px",
                      fontSize: "9px",
                      fontFamily: "'Inter', sans-serif",
                      fontWeight: active ? 600 : 400,
                      color: active ? "var(--map-active-color)" : "rgba(148,163,184,0.7)",
                      background: active ? "var(--map-active-label-bg)" : "rgba(15,12,41,0.7)",
                      border: active
                        ? "1px solid var(--map-active-label-border)"
                        : "1px solid transparent",
                      backdropFilter: "blur(8px)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t(labelKey)}
                    {active ? " ✓" : ""}
                  </span>
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "11px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: active ? "var(--map-active-bg)" : "rgba(255,255,255,0.06)",
                      border: active
                        ? "1px solid var(--map-active-border)"
                        : "1px solid rgba(255,255,255,0.1)",
                      backdropFilter: "blur(12px)",
                      boxShadow: active ? "0 0 12px var(--map-fab-shadow)" : "none",
                      color: active ? "var(--map-active-color)" : "rgba(148,163,184,0.6)",
                      flexShrink: 0,
                    }}
                  >
                    <Icon />
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Current mode badge — shown when FAB is closed */}
      {!isOpen && (
        <div
          className="absolute right-12 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            background: "var(--map-badge-bg)",
            backdropFilter: "blur(8px)",
            border: "1px solid var(--map-badge-border)",
            borderRadius: "6px",
            padding: "3px 8px",
            fontSize: "9px",
            color: "var(--map-badge-color)",
            fontFamily: "'Inter', sans-serif",
            whiteSpace: "nowrap",
          }}
        >
          {t(`map:visMode.${current}`)} ◀
        </div>
      )}

      {/* FAB button */}
      <motion.button
        onClick={() => onOpenChange(!isOpen)}
        aria-label={t("map:visMode.label")}
        aria-expanded={isOpen}
        whileTap={{ scale: 0.92 }}
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "14px",
          background: "var(--map-fab-gradient)",
          border: "1px solid rgba(255,255,255,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: isOpen ? "var(--map-fab-shadow-open)" : `0 4px 24px var(--map-fab-shadow)`,
          color: "white",
          flexShrink: 0,
        }}
      >
        <motion.div animate={{ rotate: isOpen ? 45 : 0 }} transition={{ duration: 0.2 }}>
          {isOpen ? <PlusIcon /> : <ActiveIcon />}
        </motion.div>
      </motion.button>
    </div>
  );
}
