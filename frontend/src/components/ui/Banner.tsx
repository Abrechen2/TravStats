import type { HTMLAttributes, JSX, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import IconButton from "./IconButton";
import { alpha, token } from "./tokens";
import { useTranslation } from "../../hooks/useTranslation";

export type BannerTone = "error" | "warning" | "info" | "success";

const TONE: Record<BannerTone, { color: string; icon: IconName }> = {
  error: { color: "bad", icon: "triangle-alert" },
  warning: { color: "warn", icon: "triangle-alert" },
  info: { color: "info", icon: "info" },
  success: { color: "good", icon: "check" },
};

/**
 * A page-level message: something the whole screen, not one field, has to say.
 *
 * One tone API for what used to be red, amber, blue and green boxes in forty
 * hand-built variants. `error` and `warning` are announced at once
 * (`role="alert"`); `info` and `success` politely (`role="status"`). Short text
 * in `children`, the detail behind an ⓘ is the caller's `Toggletip`.
 */
export default function Banner({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
  testId,
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, "title" | "className" | "children"> & {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  /** One way forward (a Button) — right-aligned. */
  action?: ReactNode;
  onDismiss?: () => void;
  testId?: string;
  className?: string;
}): JSX.Element {
  const { t } = useTranslation(["common"]);
  const { color, icon } = TONE[tone];
  return (
    <div
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      data-testid={testId}
      data-tone={tone}
      {...rest}
      className={`flex items-start${className ? ` ${className}` : ""}`}
      style={{
        gap: "var(--ts-space-md)",
        padding: "var(--ts-space-md) var(--ts-space-lg)",
        borderRadius: "var(--ts-radius-card)",
        background: alpha(token(color), 12),
        border: `1px solid ${alpha(token(color), 45)}`,
        color: token("text"),
      }}
    >
      <span style={{ color: token(color), marginTop: 2 }}>
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        {title && <div style={{ fontWeight: 700 }}>{title}</div>}
        {children && <div className="t-body whitespace-pre-line">{children}</div>}
      </div>
      {action}
      {onDismiss && (
        <IconButton label={t("common:buttons.dismiss")} onClick={onDismiss}>
          <Icon name="x" size={16} />
        </IconButton>
      )}
    </div>
  );
}
