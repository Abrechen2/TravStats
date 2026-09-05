import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const CONTROL_STYLE = {
  minHeight: "var(--ts-size-touch-min)",
  width: "100%",
  padding: "0 var(--ts-space-lg)",
  borderRadius: "var(--ts-radius-button)",
  background: "var(--ts-surface)",
  border: "1px solid var(--ts-border-input)",
  color: "var(--ts-text)",
  fontFamily: "var(--ts-font-ui)",
  fontSize: 14,
} as const;

interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  /**
   * The error, as a line under the field. Never a toast: a toast about a form
   * disappears while the form is still wrong, and it does not say which field.
   */
  error?: string;
  /** One sentence. If it needs two, it is not a hint, it is documentation. */
  hint?: ReactNode;
  children: ReactNode;
}

/** Label above, control, then hint or error. The order never changes. */
export function Field({ label, htmlFor, error, hint, children }: FieldProps): JSX.Element {
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
      <label htmlFor={htmlFor} className="t-caption" style={{ color: "var(--ts-muted)" }}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="t-caption" style={{ color: "var(--ts-bad)" }} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="t-caption">{hint}</span>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid = false, style, ...rest }: InputProps): JSX.Element {
  return (
    <input
      className="ts-control"
      style={{
        ...CONTROL_STYLE,
        border: `1px solid ${invalid ? "var(--ts-bad)" : "var(--ts-border-input)"}`,
        ...style,
      }}
      {...rest}
    />
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function TextArea({ invalid = false, style, ...rest }: TextAreaProps): JSX.Element {
  return (
    <textarea
      className="ts-control"
      style={{
        ...CONTROL_STYLE,
        padding: "var(--ts-space-md) var(--ts-space-lg)",
        lineHeight: 1.45,
        resize: "vertical",
        border: `1px solid ${invalid ? "var(--ts-bad)" : "var(--ts-border-input)"}`,
        ...style,
      }}
      {...rest}
    />
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  children: ReactNode;
}

export function Select({ invalid = false, children, style, ...rest }: SelectProps): JSX.Element {
  return (
    <select
      className="ts-control"
      style={{
        ...CONTROL_STYLE,
        border: `1px solid ${invalid ? "var(--ts-bad)" : "var(--ts-border-input)"}`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** One line under the label saying what turning it on actually does. */
  sub?: ReactNode;
  disabled?: boolean;
  id?: string;
}

/**
 * A switch, not a checkbox.
 *
 * The difference is not cosmetic: a checkbox is a choice you confirm later, a
 * switch takes effect the moment you touch it. Everything in settings is the
 * second kind, and the app draws the first.
 */
export function Switch({ checked, onChange, label, sub, disabled, id }: SwitchProps): JSX.Element {
  return (
    <label
      htmlFor={id}
      className="flex items-start justify-between"
      style={{
        gap: "var(--ts-space-lg)",
        minHeight: "var(--ts-size-touch-min)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span className="flex min-w-0 flex-col" style={{ gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text)" }}>{label}</span>
        {sub ? <span className="t-caption">{sub}</span> : null}
      </span>
      <span
        style={{
          position: "relative",
          flexShrink: 0,
          width: 42,
          height: 24,
          borderRadius: "var(--ts-radius-pill)",
          background: checked ? "var(--ts-accent)" : "var(--ts-surface2)",
          border: `1px solid ${checked ? "var(--ts-accent)" : "var(--ts-border-button)"}`,
          transition: "background var(--ts-motion-fast) var(--ts-ease-standard)",
        }}
      >
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            margin: 0,
            cursor: "inherit",
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 21 : 3,
            width: 18,
            height: 18,
            borderRadius: "var(--ts-radius-pill)",
            background: checked ? "var(--ts-bg)" : "var(--ts-muted)",
            transition: "left var(--ts-motion-fast) var(--ts-ease-standard)",
          }}
        />
      </span>
    </label>
  );
}
