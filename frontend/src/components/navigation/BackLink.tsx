import type { CSSProperties, JSX, MouseEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { previousEntry } from "../../lib/navigation/navHistory";

/**
 * The in-app "← Logbuch · Unterkünfte" link, made a real Back.
 *
 * It used to be a plain link to the list's bare URL, so it opened the list
 * fresh: page 1, filters gone, at the top (owner report 2026-11-23). When the
 * entry behind this one IS that list, a click now goes back in history, and
 * the list returns with its query (page, filters, search) and its scroll. On
 * a deep link — a bookmark, a new tab, a link from another page — there is
 * nothing to go back to, and the link opens the list as before.
 *
 * It stays an `<a href>`: a middle click or "open in new tab" still opens the
 * list, which only a link can offer.
 */

function pathOf(to: string): string {
  const path = to.split(/[?#]/)[0] ?? to;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** True when Back would land on `backTo`'s page. */
export function canGoBackTo(backTo: string): boolean {
  const previous = previousEntry();
  return previous !== null && pathOf(previous.pathname) === pathOf(backTo);
}

export function useBackNavigation(backTo: string): (event: MouseEvent<HTMLAnchorElement>) => void {
  const navigate = useNavigate();
  return (event) => {
    // A modified click means "somewhere else" (new tab, new window): the browser's.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (!canGoBackTo(backTo)) return;
    event.preventDefault();
    navigate(-1);
  };
}

interface BackLinkProps {
  to: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export default function BackLink({ to, children, className, style }: BackLinkProps): JSX.Element {
  const onClick = useBackNavigation(to);
  return (
    <Link to={to} onClick={onClick} className={className} style={style}>
      {children}
    </Link>
  );
}
