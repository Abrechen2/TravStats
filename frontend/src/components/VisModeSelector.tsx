import type { VisMode } from "../types/visMode";

interface VisModeButton {
  mode: VisMode;
  label: string;
  icon: string;
}

const BUTTONS: VisModeButton[] = [
  { mode: "routes", label: "Routes", icon: "✈" },
  { mode: "globe", label: "Globe", icon: "🌍" },
  { mode: "heatmap", label: "Heatmap", icon: "🌡" },
  { mode: "hexagon", label: "Hexagon", icon: "⬡" },
  { mode: "columns", label: "3D Columns", icon: "📊" },
  { mode: "trips", label: "Trips", icon: "▶" },
];

interface VisModeSeelctorProps {
  current: VisMode;
  onChange: (mode: VisMode) => void;
}

export function VisModeSelector({ current, onChange }: VisModeSeelctorProps): JSX.Element {
  return (
    <div
      style={{ background: "rgba(22,27,34,0.85)" }}
      className="flex gap-1 p-1 rounded-lg border border-[var(--border-default)]"
    >
      {BUTTONS.map(({ mode, label, icon }) => (
        <button
          key={mode}
          title={label}
          aria-label={label}
          aria-pressed={current === mode}
          onClick={() => onChange(mode)}
          className={[
            "p-2 rounded text-sm transition-colors hover:bg-[var(--bg-elevated)]",
            current === mode ? "ring-1 ring-[var(--accent-primary)] bg-[var(--bg-elevated)]" : "",
          ].join(" ")}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
