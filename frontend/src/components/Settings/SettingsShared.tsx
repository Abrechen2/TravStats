import React from "react";

import HelpIcon from "../Help/HelpIcon";

// ---------------------------------------------------------------------------
// SectionCard
// ---------------------------------------------------------------------------
interface SectionCardProps {
  children: React.ReactNode;
}

/**
 * A settings section: its heading ABOVE the card, its controls inside.
 *
 * Round-4 export ("Einstellungen v3"): the heading is a mono label with one
 * explanatory line, standing on the page; the card below holds only what the
 * reader operates. Every section used to draw its title inside its own card,
 * so twenty cards each opened with a 20px heading and the page read as a
 * stack of forms rather than one index of settings.
 *
 * The split is made here, once, from the section's own `SectionTitle` —
 * twenty-two section files already pass their title as the first child, so
 * none of them needed to change shape to get the new layout.
 */
export function SectionCard({ children }: SectionCardProps): JSX.Element {
  const items = React.Children.toArray(children);
  const headIndex = items.findIndex(
    (child) => React.isValidElement(child) && child.type === SectionTitle
  );
  const head = headIndex === -1 ? null : items[headIndex];
  const body = headIndex === -1 ? items : items.filter((_, index) => index !== headIndex);

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {head}
      {body.length > 0 ? (
        <div
          className="space-y-4"
          style={{
            background: "var(--ts-surface)",
            border: "1px solid var(--ts-border)",
            borderRadius: "var(--ts-radius-card)",
            padding: "var(--ts-space-xl)",
          }}
        >
          {body}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionTitle
// ---------------------------------------------------------------------------
interface SectionTitleProps {
  title: string;
  description?: string;
  /** Beside the label: "Beta", a version. Small, and never an action. */
  badge?: React.ReactNode;
  /** Right-aligned on the label's line: a pointer elsewhere, a link. */
  aside?: React.ReactNode;
}

/**
 * The mono label and its one line of explanation. A real `h2` — the label is
 * set in capitals by CSS, so a screen reader still hears the words, not the
 * letters.
 */
export function SectionTitle({ title, description, badge, aside }: SectionTitleProps): JSX.Element {
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
        <h2 className="t-label-mono">{title}</h2>
        {badge}
        {aside ? (
          <span className="t-caption" style={{ marginLeft: "auto" }}>
            {aside}
          </span>
        ) : null}
      </div>
      {description && <p className="t-caption">{description}</p>}
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
