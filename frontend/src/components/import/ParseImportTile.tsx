import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import DomainImportPanel from "./DomainImportPanel";
import { ImportTileShell } from "./ImportTileShell";
import type { DomainImportAdapter } from "./types";

interface ParseImportTileProps {
  title: string;
  description: string;
  /** Label on the tile's action (button or link). */
  actionLabel: string;
  /**
   * Opens the parse flow IN PLACE. Domains that own an adapter (cruise,
   * lodging) import without leaving the hub.
   */
  adapter?: DomainImportAdapter;
  /**
   * Where to send the user instead, for a domain whose parse flow cannot be
   * hosted here. Only flights: their e-mail/PDF route ends in the multi-flight
   * review loop wired into the flight form, and a second copy of that loop
   * (three pages already duplicate its submit handling) would drift. The tile
   * therefore starts the route rather than re-implementing it.
   */
  to?: string;
}

/**
 * The e-mail / PDF route as a first-class tile in the central import hub.
 *
 * The hub used to describe itself as "bundled per area" while holding only the
 * two bulk CSV paths — the primary way bookings actually arrive lived solely
 * behind "+ Hinzufügen → Flug → E-Mail importieren" (#238). Anyone following
 * the app's own pointer to the hub still had to know that.
 */
export function ParseImportTile({
  title,
  description,
  actionLabel,
  adapter,
  to,
}: ParseImportTileProps): JSX.Element {
  const [open, setOpen] = useState(false);

  const action = adapter ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex items-center gap-2 whitespace-nowrap rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm text-(--text-primary) hover:border-(--accent)"
    >
      <span aria-hidden="true">✉️</span>
      <span>{actionLabel}</span>
    </button>
  ) : (
    <Link
      to={to ?? "/"}
      className="flex items-center gap-2 whitespace-nowrap rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm text-(--text-primary) hover:border-(--accent)"
    >
      <span aria-hidden="true">✉️</span>
      <span>{actionLabel}</span>
    </Link>
  );

  return (
    <div data-testid="import-tile-parse">
      <ImportTileShell title={title} description={description} picker={action} />
      {adapter && (
        <DomainImportPanel
          open={open}
          onClose={() => setOpen(false)}
          onItemsCreated={() => setOpen(false)}
          adapter={adapter}
        />
      )}
    </div>
  );
}
