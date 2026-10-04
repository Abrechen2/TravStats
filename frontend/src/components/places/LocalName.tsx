import type { JSX } from "react";

/**
 * A place's second name — the one on the sign, in the place's own script —
 * shown quietly beside or under the readable one (forgejo#199). Renders
 * nothing when there is none: most places have one name, and an empty slot
 * would only push the layout around.
 */
export function LocalName({
  value,
  block = false,
  className = "",
  testId,
}: {
  value: string | null | undefined;
  /** Under the name (a header, a card) rather than after it (a list row). */
  block?: boolean;
  className?: string;
  testId?: string;
}): JSX.Element | null {
  if (!value) return null;
  return (
    <span
      className={`${block ? "block" : "ml-1.5"} text-xs font-normal ${className}`.trim()}
      style={{ color: "var(--text-muted)" }}
      data-testid={testId}
    >
      {value}
    </span>
  );
}

export default LocalName;
