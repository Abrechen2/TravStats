import type { JSX, ReactNode } from "react";

/** One collapsible group of the stay editor, open by default. */
export function StayEditorSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <details
      open
      className="mb-4 rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)]/50 p-3"
    >
      <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
