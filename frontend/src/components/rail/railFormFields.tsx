import type { InputHTMLAttributes, JSX, ReactNode } from "react";

/** The rail form's field chrome, shared by the dialog and its detail sections. */
export const INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-surface) px-3 py-3 text-base text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-hidden";

/** A text field whose label stays visible once typed into (forgejo#249). */
export function LabelledInput({
  label,
  ...input
}: { label: string } & InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <label className="block text-sm">
      {label}
      <input {...input} className={`mt-1 ${INPUT_CLASS}`} />
    </label>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <details open className="mb-4 rounded-md border border-border bg-(--bg-surface)/50 p-3">
      <summary className="cursor-pointer text-sm font-medium text-(--text-primary)">
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
