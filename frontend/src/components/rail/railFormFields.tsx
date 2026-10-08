import type { InputHTMLAttributes, JSX, ReactNode } from "react";
import { FieldError, fieldErrorProps } from "../form";
import { railFieldId, type RailFormErrorField } from "./railFormModel";

/** The rail form's field chrome, shared by the dialog and its detail sections. */
export const INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-surface) px-3 py-3 text-base text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-hidden";

/** What a refusal says about one field, or null — read by every field that can be named. */
export type RailFieldErrorFor = (field: RailFormErrorField) => string | null;

/**
 * A text field whose label stays visible once typed into (forgejo#249). With
 * a `field`, it gets that field's id and shows a refusal naming it AT the
 * field (forgejo#246) — the message outside the label, or it would become
 * part of the field's name.
 */
export function LabelledInput({
  label,
  field,
  error = null,
  ...input
}: {
  label: string;
  field?: RailFormErrorField;
  error?: string | null;
} & InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const id = field ? railFieldId(field) : undefined;
  return (
    <div>
      <label className="block text-sm">
        {label}
        <input
          {...input}
          id={id}
          {...(id ? fieldErrorProps(id, error) : {})}
          className={`mt-1 ${INPUT_CLASS}`}
        />
      </label>
      {id && <FieldError id={id} error={error} />}
    </div>
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
