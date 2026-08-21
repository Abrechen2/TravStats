import React from "react";

// ---------------------------------------------------------------------------
// AmberToggle
// ---------------------------------------------------------------------------
interface AmberToggleProps {
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  /** Lets an external `<label htmlFor>` name the toggle. */
  id?: string;
}

export function AmberToggle({
  checked,
  onChange,
  disabled = false,
  id,
}: AmberToggleProps): JSX.Element {
  return (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className="checkbox"
    />
  );
}

// ---------------------------------------------------------------------------
// SectionCard
// ---------------------------------------------------------------------------
interface SectionCardProps {
  children: React.ReactNode;
}

export function SectionCard({ children }: SectionCardProps): JSX.Element {
  return (
    <div
      className="rounded-xl p-6 space-y-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionTitle
// ---------------------------------------------------------------------------
interface SectionTitleProps {
  title: string;
  description?: string;
}

export function SectionTitle({ title, description }: SectionTitleProps): JSX.Element {
  return (
    <div>
      <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h2>
      {description && (
        <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>
      )}
    </div>
  );
}
