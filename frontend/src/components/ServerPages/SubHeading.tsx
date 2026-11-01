import type { JSX, ReactNode } from "react";
import { ExpertPill } from "../ui/ExpertPill";

/**
 * A registry section inside a mount that holds several (Allgemein, Adressen,
 * Passkeys on one card). The id is the anchor `/settings/server#addresses`
 * scrolls to.
 */
export default function SubHeading({
  id,
  children,
  expert = false,
}: {
  id: string;
  children: ReactNode;
  expert?: boolean;
}): JSX.Element {
  return (
    <h3
      id={`settings-${id}`}
      className="t-label-mono flex flex-wrap items-center"
      style={{ gap: "var(--ts-space-sm)", scrollMarginTop: 80 }}
    >
      {children}
      {expert ? <ExpertPill /> : null}
    </h3>
  );
}
