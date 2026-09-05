import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** One line under the title — scope, count, provenance. Never a paragraph. */
  meta?: ReactNode;
  /** Right-hand slot: the page's own actions. At most two. */
  actions?: ReactNode;
}

/**
 * The one page heading.
 *
 * The app carries seventeen different h1 class chains today; every one of them
 * is this. The title is `.t-screen-title` and nothing else decides its size,
 * weight or colour — that is the whole point of the class.
 */
export default function PageHeader({ title, meta, actions }: PageHeaderProps): JSX.Element {
  return (
    <div
      className="flex flex-wrap items-start justify-between"
      style={{ gap: "var(--ts-space-lg)", marginBottom: "var(--ts-space-xl)" }}
    >
      <div className="flex min-w-0 flex-col" style={{ gap: "var(--ts-space-xs)" }}>
        <h1 className="t-screen-title">{title}</h1>
        {meta ? <div className="t-caption">{meta}</div> : null}
      </div>
      {actions ? (
        <div className="flex items-center" style={{ gap: "var(--ts-space-sm)" }}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
