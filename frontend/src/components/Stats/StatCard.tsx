import type { JSX, ReactNode } from "react";

interface StatCardProps {
  title: string;
  value: ReactNode;
  description: ReactNode;
  footnote?: ReactNode;
  valueSize?: "sm" | "md" | "lg";
  title2?: never;
}

const VALUE_CLASS: Record<NonNullable<StatCardProps["valueSize"]>, string> = {
  sm: "text-2xl",
  md: "text-3xl",
  lg: "text-4xl",
};

// Unified stat card for the AdvancedStats screen. Replaces a sprawl of
// per-card `from-X to-Y` Tailwind gradients (BRAND.md §7 anti-pattern).
// All cards share the dark elevated surface; the big number uses the
// brand accent so flight-domain stats reinforce the amber identity.
export default function StatCard({
  title,
  value,
  description,
  footnote,
  valueSize = "lg",
}: StatCardProps): JSX.Element {
  return (
    <div
      className="rounded-lg border p-6 shadow-md"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--color-border)",
        color: "var(--text-primary)",
      }}
    >
      <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      <p className={`mb-1 font-bold ${VALUE_CLASS[valueSize]}`} style={{ color: "var(--accent)" }}>
        {value}
      </p>
      <p className="text-sm opacity-75">{description}</p>
      {footnote && <p className="mt-2 text-xs opacity-60">{footnote}</p>}
    </div>
  );
}
