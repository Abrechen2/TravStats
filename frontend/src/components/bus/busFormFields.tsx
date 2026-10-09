import type { InputHTMLAttributes, JSX, ReactNode } from "react";
import { FieldError, fieldErrorProps } from "../form";
import { busFieldId, type BusFormErrorField } from "./busFormModel";

/** The bus form's field chrome, shared by the dialog, its sections and its terminal fields. */
export const INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-surface) px-3 py-3 text-base text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-hidden";

/**
 * A checkbox row a finger can hit (forgejo#249): on a coarse pointer the row,
 * which is the label and so toggles the box, reaches the touch minimum. A
 * mouse keeps the compact line.
 */
export const CHECK_ROW =
  "flex items-center gap-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)";

/** The id of a field's always-visible hint, for its `aria-describedby`. */
export const hintId = (field: BusFormErrorField): string => `${busFieldId(field)}-hint`;

/** What a refusal says about one field, or null — read by every field that can be named. */
export type BusFieldErrorFor = (field: BusFormErrorField) => string | null;

/**
 * A field whose label stays visible once typed into (forgejo#249) — the bus
 * form had only an `aria-label` and a placeholder, so the name of a filled
 * field was gone from the screen. With a `field` it gets that field's id and
 * shows a refusal naming it AT the field (forgejo#246); the message sits
 * outside the label, or it would become part of the field's name. A `hint`
 * is visible text the input reads as its description — help a tap and a
 * screen reader reach, never a `title`.
 */
export function LabelledInput({
  label,
  field,
  error = null,
  hint,
  ...input
}: {
  label: string;
  field: BusFormErrorField;
  error?: string | null;
  hint?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const id = busFieldId(field);
  return (
    <div>
      <label className="block text-sm">
        {label}
        <input
          {...input}
          id={id}
          {...fieldErrorProps(id, error, hint ? hintId(field) : undefined)}
          className={`mt-1 ${INPUT_CLASS}`}
        />
      </label>
      <FieldError id={id} error={error} />
      {hint && (
        <p id={hintId(field)} className="mt-1 text-xs text-(--text-muted)">
          {hint}
        </p>
      )}
    </div>
  );
}
