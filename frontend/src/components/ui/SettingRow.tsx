import type { JSX, ReactNode } from "react";

interface SettingRowProps {
  title: ReactNode;
  /** One line saying what the setting does. */
  sub?: ReactNode;
  /** The control: pills, a switch, a select, a button. */
  control: ReactNode;
  /** Ties the title to a form control that has an id. */
  htmlFor?: string;
}

/**
 * One setting: what it is on the left, how to change it on the right.
 *
 * The row of the round-4 settings card. Where the space runs out the control
 * wraps under the text rather than squeezing it — a phone reads the title
 * first and then acts, which is the order the row is written in.
 */
export function SettingRow({ title, sub, control, htmlFor }: SettingRowProps): JSX.Element {
  const Title = htmlFor ? "label" : "span";
  return (
    <div
      className="ts-setting-row flex flex-wrap items-center justify-between"
      style={{ gap: "var(--ts-space-md) var(--ts-space-lg)" }}
    >
      <span className="flex min-w-0 flex-col" style={{ gap: 2, flex: "1 1 220px" }}>
        <Title
          htmlFor={htmlFor}
          style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}
        >
          {title}
        </Title>
        {sub ? <span className="t-caption">{sub}</span> : null}
      </span>
      <span className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
        {control}
      </span>
    </div>
  );
}

/**
 * Rows in a settings card, each separated from the next by a hairline — the
 * card's padding is the outer edge, the dividers are the inner one.
 */
export function SettingRows({ children }: { children: ReactNode }): JSX.Element {
  return <div className="ts-setting-rows">{children}</div>;
}
