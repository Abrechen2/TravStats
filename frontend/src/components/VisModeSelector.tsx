import type { VisMode } from "../types/visMode";

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

interface VisModeButton {
  mode: VisMode;
  label: string;
  Icon: () => JSX.Element;
}

const BUTTONS: VisModeButton[] = [
  { mode: "routes", label: "Routes", Icon: RoutesIcon },
  { mode: "globe", label: "Globe", Icon: GlobeIcon },
  { mode: "heatmap", label: "Heat", Icon: HeatmapIcon },
  { mode: "hexagon", label: "Hex", Icon: HexagonIcon },
  { mode: "columns", label: "3D", Icon: ColumnsIcon },
  { mode: "trips", label: "Trips", Icon: TripsIcon },
];

interface VisModeSeelctorProps {
  current: VisMode;
  onChange: (mode: VisMode) => void;
}

export function VisModeSelector({ current, onChange }: VisModeSeelctorProps): JSX.Element {
  return (
    <div
      className="flex gap-0.5 p-1 rounded-xl border"
      style={{
        background: "rgba(13,17,23,0.92)",
        borderColor: "rgba(48,54,61,0.8)",
        backdropFilter: "blur(12px)",
      }}
    >
      {BUTTONS.map(({ mode, label, Icon }) => {
        const active = current === mode;
        return (
          <button
            key={mode}
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => onChange(mode)}
            className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg transition-all duration-150"
            style={{
              background: active ? "rgba(232,160,69,0.15)" : "transparent",
              color: active ? "#e8a045" : "#8b949e",
            }}
          >
            <Icon />
            <span className="text-[9px] font-medium leading-none tracking-wide uppercase">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
