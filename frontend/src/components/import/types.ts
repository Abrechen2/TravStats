import type { ReactNode } from "react";

export type ImportDomain = "flight" | "cruise" | "lodging" | "trip" | "poi";

/**
 * The domains a document can actually be parsed FOR. Deliberately narrower
 * than `ImportDomain`: a place is never booked, and the tour-operator parser
 * for trips does not exist yet. The chooser uses this to decide whether a drop
 * zone may appear at all, so a domain cannot offer a reading the backend has
 * no route for — a type error rather than a runtime 400.
 */
export const PARSEABLE_IMPORT_DOMAINS = ["flight", "cruise", "lodging"] as const;
export type ParseableImportDomain = (typeof PARSEABLE_IMPORT_DOMAINS)[number];

export function isParseableDomain(domain: ImportDomain): domain is ParseableImportDomain {
  return (PARSEABLE_IMPORT_DOMAINS as readonly string[]).includes(domain);
}

/**
 * One way into the app, as the user thinks of it: "I have a booking mail",
 * "I have a flight number", "I'll type it". The chooser asks *what do you
 * have* before it asks for any data, and the routes are the answers.
 *
 * Ordering carries meaning: the route that fills in the most stands first and
 * is marked `primary`; typing everything by hand is always last and lives in
 * the footer, not in this list.
 */
export interface ImportRoute {
  id: string;
  /** Emoji marker. Decorative — the title carries the meaning. */
  icon: string;
  title: string;
  description: string;
  /** Highlighted route — at most one per adapter. */
  primary?: boolean;
  /** Trailing button label. Omit when `render` supplies its own control. */
  actionLabel?: string;
  onSelect?: () => void;
  /** Inline body under the description, e.g. a search field. */
  render?: () => ReactNode;
  /**
   * Built but not offered yet. The route stays in the code — and in the
   * tests — instead of being commented out, so switching a domain on is one
   * flag rather than an archaeology exercise.
   */
  hidden?: boolean;
}

/**
 * Adapter contract: each domain provides one of these to plug into
 * `<DomainImportPanel>`. Keeps the shell domain-agnostic so a new domain opts
 * in by writing one adapter file.
 */
export interface DomainImportAdapter {
  domain: ImportDomain;
  /** Visible label for the panel header, e.g. "Flug hinzufügen". */
  panelTitle: string;
  /** Short hint under the title — the chooser's question. */
  panelHint: string;
  /** File extensions the drop zone accepts (drag & drop + file picker). */
  acceptedEmailExtensions: string[];
  /**
   * The drop-zone route, which every domain with a parser shares. Set to
   * `false` for a domain whose parser does not exist yet — the chooser then
   * opens with that domain's own routes instead of promising a reading that
   * cannot happen.
   */
  supportsDocumentImport?: boolean;
  /** Copy for the shared drop-zone route. Falls back to generic wording. */
  documentRoute?: Pick<ImportRoute, "title" | "description">;
  /** Domain-specific routes, rendered after the drop zone in this order. */
  routes?: ImportRoute[];
  /** Footer link label. Defaults to the generic "enter by hand". */
  manualLabel?: string;
  /** Render the manual-entry experience as a sibling modal. */
  renderManual: (props: { onClose: () => void; onSaved: () => void }) => ReactNode;
  /**
   * Render the post-parse review/preview UI (e.g. FlightReviewModal,
   * LodgingImportPreviewModal). Called after a successful parse.
   */
  renderReviewModal: (props: ReviewModalProps) => ReactNode;
}

export interface ReviewModalProps {
  /** Raw parser response — adapter narrows it. */
  parseResult: unknown;
  /** Optional original email metadata for re-edit / training. */
  emailMeta?: { subject?: string; text?: string; html?: string };
  /** Called once the user commits the items (creates them server-side). */
  onCommit: () => void | Promise<void>;
  /** Called when the user dismisses the review without saving. */
  onCancel: () => void;
}
