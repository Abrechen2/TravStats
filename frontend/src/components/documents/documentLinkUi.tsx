import { Link, useInRouterContext } from "react-router-dom";
import type { JSX, ReactNode } from "react";

import { apiErrorMachineCode } from "../../lib/apiError";
import type { DocumentEntryInfo } from "../../lib/api/documents";

/**
 * Where an entry's own page lives. A stay, a visit and an expense are shown on
 * their parent's page, so those take `parentId`; the rest are their own id.
 */
export function entryHref(entry: Pick<DocumentEntryInfo, "type" | "id" | "parentId">): string {
  const id = encodeURIComponent(entry.id);
  const parent = entry.parentId ? encodeURIComponent(entry.parentId) : id;
  switch (entry.type) {
    case "flight":
      return `/flights/${id}`;
    case "cruise":
      return `/cruises/${id}`;
    case "lodgingStay":
      return `/lodging/${parent}`;
    case "trip":
      return `/trips/${id}`;
    case "placeVisit":
      return `/places/${parent}`;
    case "railJourney":
      return `/rail/${id}`;
    case "rentalBooking":
      return `/rentals/${id}`;
    case "busJourney":
      return `/bus/${id}`;
    case "ferryJourney":
      return `/ferry/${id}`;
    case "tripExpense":
      return `/trips/${parent}`;
    case "tour":
      // A roadtrip has no parent id; a day tour carries its own (the tour editor page).
      return entry.parentId ? `/tours/${id}` : `/roadtrips/${id}`;
  }
}

/** A link to an entry's page; a plain anchor where no router is mounted (a bare test render). */
export function EntryLink({
  entry,
  children,
}: {
  entry: Pick<DocumentEntryInfo, "type" | "id" | "parentId">;
  children: ReactNode;
}): JSX.Element {
  const inRouter = useInRouterContext();
  const style = { color: "var(--ts-text-bright)", textDecoration: "underline" } as const;
  return inRouter ? (
    <Link to={entryHref(entry)} style={style}>
      {children}
    </Link>
  ) : (
    <a href={entryHref(entry)} style={style}>
      {children}
    </a>
  );
}

/**
 * The locale key a failed link request maps to — one sentence per cause, so a
 * duplicate, a vanished entry and a vanished document are not all "failed".
 */
export function linkErrorKey(err: unknown): string {
  switch (apiErrorMachineCode(err)) {
    case "DOCUMENT_LINK_EXISTS":
      return "documents:links.errors.exists";
    case "DOCUMENT_ENTRY_NOT_FOUND":
      return "documents:links.errors.entryGone";
    case "DOCUMENT_NOT_FOUND":
      return "documents:links.errors.documentGone";
    case "DOCUMENT_LINK_NOT_FOUND":
      return "documents:links.errors.linkGone";
    default:
      return "documents:links.errors.failed";
  }
}
