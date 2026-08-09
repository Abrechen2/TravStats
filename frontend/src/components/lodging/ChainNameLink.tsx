import type { JSX } from "react";
import { Link } from "react-router-dom";

interface ChainNameLinkProps {
  chainId: number;
  name: string;
  className?: string;
}

/**
 * A chain name rendered as a link to its detail page (`/lodging/chains/:id`)
 * — the collaborator request was specifically "make the chain name
 * clickable", so every place a chain name is shown (the `/lodging` list's
 * "Kette" column, a hotel's own detail page, the dashboard's chains view)
 * renders it through this one component instead of duplicating the link.
 *
 * `stopPropagation` on click because every current call site sits inside a
 * clickable row/card that navigates elsewhere on click (e.g. the lodging
 * list's row navigates to the hotel) — without it, clicking the chain name
 * would trigger both navigations.
 */
export function ChainNameLink({ chainId, name, className }: ChainNameLinkProps): JSX.Element {
  return (
    <Link
      to={`/lodging/chains/${chainId}`}
      className={className ?? "hover:underline"}
      onClick={(e) => e.stopPropagation()}
    >
      {name}
    </Link>
  );
}
