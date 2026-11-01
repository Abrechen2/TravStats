import { useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import Button from "../Button";
import { Input, Select } from "../Field";
import { Segmented, type SegmentedOption } from "../Segmented";
import { alpha } from "../tokens";
import { useSettingItem } from "./itemContext";

/**
 * The controls a `SettingItem` holds (B2-B5). They read the row's context, so
 * a locked row locks whatever sits in it the same way: `disabled` (not
 * focusable, not clickable) plus `aria-disabled`, never a look-alike.
 */

export function SwitchControl({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The accessible name when the row's title is not enough. */
  label?: string;
}): JSX.Element {
  const { id, locked, describedBy } = useSettingItem();
  const coarse = useCoarsePointer();
  const track = coarse
    ? { w: 52, h: 32, knob: 26, off: 2, on: 22 }
    : { w: 42, h: 24, knob: 18, off: 3, on: 21 };
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={locked}
      aria-disabled={locked || undefined}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        flexShrink: 0,
        width: track.w,
        height: track.h,
        padding: 0,
        borderRadius: "var(--ts-radius-pill)",
        background: checked ? "var(--ts-accent)" : "var(--ts-surface2)",
        border: `1px solid ${checked ? "var(--ts-accent)" : "var(--ts-border-button)"}`,
        opacity: locked ? 0.5 : 1,
        cursor: locked ? "not-allowed" : "pointer",
        transition: "background var(--ts-motion-fast) var(--ts-ease-standard)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: (track.h - 2 - track.knob) / 2,
          left: checked ? track.on : track.off,
          width: track.knob,
          height: track.knob,
          borderRadius: "var(--ts-radius-pill)",
          background: checked ? "var(--ts-bg)" : "var(--ts-muted)",
          transition: "left var(--ts-motion-fast) var(--ts-ease-standard)",
        }}
      />
    </button>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  name?: string;
  /** This option cannot be chosen right now; the others still can. */
  disabled?: boolean;
}

/**
 * B3: up to three options are pills, four or more a list. The list is the
 * platform's own select, which is what gives it the type-ahead: typing the
 * start of an option jumps to it, on a keyboard and on a tablet alike.
 */
export function ChoiceControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (next: T) => void;
  label: string;
}): JSX.Element {
  const { id, locked, describedBy } = useSettingItem();
  if (options.length <= 3) {
    const pills: SegmentedOption<T>[] = options.map((o) => ({
      value: o.value,
      label: o.label,
      name: o.name,
      disabled: o.disabled,
    }));
    return (
      <Segmented
        label={label}
        value={value}
        options={pills}
        onChange={onChange}
        disabled={locked}
      />
    );
  }
  return (
    <Select
      id={id}
      value={value}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={locked}
      aria-disabled={locked || undefined}
      onChange={(event) => onChange(event.target.value as T)}
      style={{ minWidth: 200, opacity: locked ? 0.5 : 1 }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function InputControl({
  value,
  onChange,
  type = "text",
  placeholder,
  inputMode,
}: {
  value: string;
  onChange: (next: string) => void;
  type?: "text" | "email" | "url" | "number";
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal" | "email" | "url";
}): JSX.Element {
  const { id, locked, invalid, describedBy, changed } = useSettingItem();
  return (
    <Input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      inputMode={inputMode}
      invalid={invalid}
      disabled={locked}
      aria-disabled={locked || undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
      style={{
        minWidth: 220,
        opacity: locked ? 0.5 : 1,
        ...(changed && !invalid ? { border: `1px solid ${alpha("var(--ts-accent)", 45)}` } : null),
      }}
    />
  );
}

/**
 * B4, secret: a stored secret is never put back on the screen. The field is
 * empty, says so, and empty means KEEP — `onChange` only ever carries what was
 * typed, so a caller cannot overwrite the secret with a blank by accident.
 */
export function SecretControl({
  isSet,
  onChange,
}: {
  isSet: boolean;
  onChange: (typed: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const { id, locked, invalid, describedBy, changed } = useSettingItem();
  const [typed, setTyped] = useState("");
  return (
    <Input
      id={id}
      type="password"
      autoComplete="new-password"
      value={typed}
      invalid={invalid}
      disabled={locked}
      aria-disabled={locked || undefined}
      aria-describedby={describedBy}
      placeholder={isSet ? t("settings:blocks.secret.set") : t("settings:blocks.secret.empty")}
      onChange={(event) => {
        setTyped(event.target.value);
        onChange(event.target.value);
      }}
      style={{
        minWidth: 220,
        opacity: locked ? 0.5 : 1,
        ...(changed && !invalid ? { border: `1px solid ${alpha("var(--ts-accent)", 45)}` } : null),
      }}
    />
  );
}

export function ActionControl({
  label,
  onClick,
  danger = false,
  busy = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  busy?: boolean;
  /** Not usable yet (a form that is not complete); unlike `busy`, nothing is running. */
  disabled?: boolean;
}): JSX.Element {
  // No id: the row title is a <label for> the control, and on a button it would
  // REPLACE the button's own name ("Jetzt sichern" would read as the row's title).
  const { locked, describedBy } = useSettingItem();
  return (
    <Button
      variant={danger ? "danger" : "secondary"}
      onClick={onClick}
      disabled={locked || busy || disabled}
      aria-disabled={locked || undefined}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
    >
      {label}
    </Button>
  );
}

/** B5, status: a measured value in mono; the row is information, not a control. */
export function StatusValue({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span
      data-status-value=""
      style={{ fontFamily: "var(--ts-font-mono)", fontSize: 13, color: "var(--ts-text)" }}
    >
      {children}
    </span>
  );
}

/** B5, jump: the row leads to another page or section. */
export function JumpControl({ label, onJump }: { label: string; onJump: () => void }): JSX.Element {
  // No id: the row title is a <label for> the control, and on a button it would
  // REPLACE the button's own name ("Jetzt sichern" would read as the row's title).
  const { locked, describedBy } = useSettingItem();
  return (
    <Button
      variant="secondary"
      onClick={onJump}
      disabled={locked}
      aria-disabled={locked || undefined}
      aria-describedby={describedBy}
    >
      {label} ›
    </Button>
  );
}
