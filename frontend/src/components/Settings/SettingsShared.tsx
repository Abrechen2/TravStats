import React from "react";

import HelpIcon from "../Help/HelpIcon";

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

// ---------------------------------------------------------------------------
// FieldLabel
// ---------------------------------------------------------------------------

/**
 * A field's label, with its explanation attached to the field rather than to
 * the section.
 *
 * This replaces the `InlineHelp` boxes the settings used to open with. Those
 * boxes explained three or four fields at once, above the form — so the
 * sentence about a control sat several rows away from the control, and a
 * reader who had dismissed the box once never saw it again.
 *
 * The rule for `help`, so this does not turn into a question mark on every
 * row: a field gets one ONLY when its label does not already say what it does.
 * "Sprache" needs none. "Wiederherstellungscodes" does, because the name does
 * not reveal that each one works exactly once.
 *
 * Anything a user must not miss does NOT belong here at all — a tooltip cannot
 * be hovered on a phone and vanishes at the moment of acting. Those sentences
 * stay as standing text in the dialog that performs the action, which is where
 * TravStats already puts them.
 */
export function FieldLabel({
  children,
  help,
  htmlFor,
  className = "",
}: {
  children: React.ReactNode;
  /** The explanation. Omit it when the label speaks for itself. */
  help?: string;
  htmlFor?: string;
  className?: string;
}): JSX.Element {
  return (
    <label htmlFor={htmlFor} className={`label inline-flex items-center gap-1.5 ${className}`}>
      {children}
      {help && <HelpIcon content={help} position="top" />}
    </label>
  );
}
