import type { ButtonHTMLAttributes, ReactNode } from "react";
import { alpha } from "./tokens";

export type ButtonVariant = "primary" | "secondary" | "danger";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  children: ReactNode;
  /** Full-width in a form footer or a sheet. */
  block?: boolean;
  /** Leading icon slot. Trailing icons are not a thing here. */
  icon?: ReactNode;
  className?: string;
}

/**
 * Two variants, and a third that may only appear inside a confirm dialog.
 *
 * The app has 597 `<button>` elements and 464 of them style themselves, which
 * is why no two amber buttons are the same amber. The heights are tokens (52
 * primary, 46 secondary), the label is 16/700, and it is never mono — a button
 * is an instruction, not a measurement.
 *
 * `danger` is deliberately not a red fill. A destructive action is confirmed,
 * not offered: it sits in a dialog that already states object, reach and
 * consequence, and a tinted outline there reads as "this is the one that
 * removes something" without turning the dialog into an alarm.
 */
export default function Button({
  variant = "secondary",
  children,
  block = false,
  icon,
  className,
  style,
  disabled,
  ...rest
}: ButtonProps): JSX.Element {
  const height =
    variant === "primary" ? "var(--ts-size-button-primary)" : "var(--ts-size-button-secondary)";

  const skin =
    variant === "primary"
      ? {
          background: "var(--ts-accent)",
          color: "var(--ts-accent-text)",
          border: "1px solid var(--ts-accent)",
        }
      : variant === "danger"
        ? {
            background: alpha("var(--ts-bad)", 12),
            color: "var(--ts-bad)",
            border: `1px solid ${alpha("var(--ts-bad)", 45)}`,
          }
        : {
            background: "transparent",
            color: "var(--ts-text)",
            border: "1px solid var(--ts-border-button)",
          };

  return (
    <button
      type="button"
      disabled={disabled}
      data-variant={variant}
      className={`ts-button ${className ?? ""}`.trim()}
      style={{
        height,
        padding: "0 var(--ts-space-xl)",
        borderRadius: "var(--ts-radius-button)",
        fontWeight: 700,
        fontSize: 16,
        fontFamily: "var(--ts-font-ui)",
        display: block ? "flex" : "inline-flex",
        width: block ? "100%" : undefined,
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--ts-space-sm)",
        whiteSpace: "nowrap",
        // 0.5 everywhere; the create button's 0.3 belongs to the form-error
        // recipe, not to every disabled button.
        opacity: disabled ? 0.5 : 1,
        transition: "background var(--ts-motion-fast) var(--ts-ease-standard)",
        ...skin,
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
