import type { ReactNode } from "react";

export type ImportDomain = "flight" | "cruise" | "lodging";

/**
 * Adapter contract: each domain provides one of these to plug into
 * `<DomainImportPanel>`. Keeps the shell domain-agnostic so future domains
 * (hotels, POI, …) can opt in by writing one adapter file.
 */
export interface DomainImportAdapter {
  domain: ImportDomain;
  /** Visible label for the panel header, e.g. "Flug importieren". */
  panelTitle: string;
  /** Short hint under the title. */
  panelHint: string;
  /** File extensions the email tab accepts (drag&drop + filepicker). */
  acceptedEmailExtensions: string[];
  /** Render the manual-entry experience as a sibling modal. */
  renderManual: (props: { onClose: () => void; onSaved: () => void }) => ReactNode;
  /**
   * Render the post-parse review/preview UI (e.g. FlightReviewModal,
   * CruiseImportPreviewModal). Called after a successful parse.
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
