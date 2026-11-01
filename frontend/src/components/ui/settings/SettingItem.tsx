import { useId, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import HelpIcon from "../../Help/HelpIcon";
import { ExpertPill } from "../ExpertPill";
import { alpha } from "../tokens";
import { SettingItemCtx } from "./itemContext";
import { Dependency, ErrorLine, RequiredLine } from "./notes";
import { SaveStateMark } from "./SaveStateMark";
import { ScopeMark, type RowScope } from "./ScopeMark";
import type { SettingWrite } from "./useSettingWrite";

export type LockReason = "demo" | "adminForbade" | "dependency";

interface SettingItemProps {
  title: ReactNode;
  /** The accessible name of the control, when `title` is not a plain string. */
  name?: string;
  /** Short line: what the setting does. */
  sub?: ReactNode;
  scope?: RowScope;
  expert?: boolean;
  /** Help in the "?" toggletip, for the one question this row reliably raises. */
  help?: string;
  /** The control: one of `controls.tsx`, or the caller's own. */
  control?: ReactNode;
  /** Immediate rows: the write behind the control (see `useSettingWrite`). */
  save?: Pick<SettingWrite<unknown>, "state" | "reason" | "retry" | "discard">;
  /** A form error, in the first person, under the field. */
  error?: string;
  /** B15: a required value is missing. */
  required?: string;
  /** B10: why it does not take effect, with the jump that fixes it. */
  dependency?: { reason: ReactNode; jump?: { label: string; onJump: () => void } };
  /** B11: a background job. */
  job?: ReactNode;
  /**
   * Locked means locked: the control is disabled and `aria-disabled`, not
   * focusable, and the reason is written under the row.
   */
  locked?: { why: LockReason; reason: ReactNode };
  /** Group rows: this value differs from the saved one. */
  changed?: boolean;
  /** Search hit or deep link (`proBg`). */
  highlighted?: boolean;
  /** Other content under the row: a one-time secret, a list. */
  children?: ReactNode;
}

/**
 * B1: one setting. Name · scope · EXPERT · save state · short line · "?" ·
 * control, and under them, in this order: error, required warning, dependency,
 * lock reason, job, children.
 *
 * A dependency is a reason AND a jump; a lock is a reason alone, because the
 * one who locked it (the demo, the admin) is not the user.
 */
export function SettingItem({
  title,
  name,
  sub,
  scope,
  expert = false,
  help,
  control,
  save,
  error,
  required,
  dependency,
  job,
  locked,
  changed = false,
  highlighted = false,
  children,
}: SettingItemProps): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const uid = useId();
  const controlId = `${uid}-control`;
  const errorId = `${uid}-error`;
  const requiredId = `${uid}-required`;
  const dependencyId = `${uid}-dependency`;
  const lockId = `${uid}-lock`;
  const describedBy =
    [
      error ? errorId : null,
      required ? requiredId : null,
      dependency ? dependencyId : null,
      locked ? lockId : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  // A dependency that is not met locks the control too: the setting cannot act.
  const isLocked = Boolean(locked) || Boolean(dependency);

  return (
    <SettingItemCtx.Provider
      value={{
        id: controlId,
        locked: isLocked,
        invalid: Boolean(error) || Boolean(required),
        describedBy,
        changed,
      }}
    >
      <div
        className="ts-setting-row flex flex-col"
        data-setting-row=""
        data-locked={isLocked || undefined}
        style={{
          gap: "var(--ts-space-sm)",
          ...(highlighted ? { background: "var(--ts-pro-bg)" } : null),
          ...(required
            ? {
                borderLeft: `2px solid ${alpha("var(--ts-warn)", 45)}`,
                paddingLeft: "var(--ts-space-md)",
              }
            : null),
        }}
      >
        <div
          className="flex flex-wrap items-center justify-between"
          style={{ gap: "var(--ts-space-md) var(--ts-space-lg)" }}
        >
          <span className="flex min-w-0 flex-col" style={{ gap: 2, flex: "1 1 220px" }}>
            <span className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
              <label
                htmlFor={controlId}
                style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}
              >
                {title}
              </label>
              {scope ? <ScopeMark scope={scope} /> : null}
              {expert ? <ExpertPill /> : null}
              {help ? (
                <HelpIcon
                  content={help}
                  subject={name ?? (typeof title === "string" ? title : undefined)}
                />
              ) : null}
              {save ? (
                <SaveStateMark
                  state={save.state}
                  reason={save.reason}
                  onRetry={save.retry}
                  onDiscard={save.discard}
                />
              ) : null}
            </span>
            {sub ? <span className="t-caption">{sub}</span> : null}
          </span>
          {control ? (
            <span
              className="flex min-w-0 max-w-full flex-wrap items-center [&>select]:max-w-full"
              style={{ gap: "var(--ts-space-sm)" }}
            >
              {control}
            </span>
          ) : null}
        </div>
        {error ? <ErrorLine id={errorId}>{error}</ErrorLine> : null}
        {required ? <RequiredLine id={requiredId}>{required}</RequiredLine> : null}
        {dependency ? (
          <Dependency id={dependencyId} reason={dependency.reason} jump={dependency.jump} />
        ) : null}
        {locked ? (
          <p id={lockId} className="t-caption" data-lock-reason={locked.why} style={{ margin: 0 }}>
            {locked.why === "demo" ? t("settings:blocks.lock.demo") : locked.reason}
          </p>
        ) : null}
        {job}
        {children}
      </div>
    </SettingItemCtx.Provider>
  );
}
