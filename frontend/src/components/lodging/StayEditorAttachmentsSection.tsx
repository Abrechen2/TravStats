import type { JSX } from "react";
import ReceiptUpload from "../ReceiptUpload";
import DocumentsSection from "../documents/DocumentsSection";
import { StayEditorSection } from "./StayEditorSection";
import type { ExtractTarget } from "../../lib/extractValues";

interface StayEditorAttachmentsSectionProps {
  /** The stay being edited, or null while one is being CREATED. */
  stayId: string | null;
  receiptUrl: string | null;
  onReceiptChange: (url: string | null) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  /** "Take the values from this receipt" — into the editor's fields, saved with the stay. */
  extract?: ExtractTarget;
}

/**
 * The files that hang off a stay: the one receipt, and the folder.
 *
 * The two are deliberately side by side and deliberately not merged. The
 * receipt is a single field the price block links to; the documents are every
 * kept original — a bill, a booking confirmation, a parking ticket. Replacing
 * the first with the second would drop the link the cost figure reads.
 *
 * Extracted from `StayEditor` for the same reason the rating, price and notes
 * blocks were: that file sits at the project's 800-line limit, and mounting
 * the documents section brought it to 799. A block with no state of its own
 * was the cheapest thing to move out.
 *
 * A stay being created has no id, so there is nothing to file documents
 * against yet — the receipt upload, which stores its URL on the unsaved form,
 * does not have that problem.
 */
export function StayEditorAttachmentsSection({
  stayId,
  receiptUrl,
  onReceiptChange,
  t,
  extract,
}: StayEditorAttachmentsSectionProps): JSX.Element {
  return (
    <>
      <StayEditorSection title={t("lodging:stayEditor.receiptSection")}>
        <ReceiptUpload
          currentReceiptUrl={receiptUrl}
          onUploadSuccess={(url): void => onReceiptChange(url)}
          onDelete={(): void => onReceiptChange(null)}
          extract={extract}
        />
      </StayEditorSection>

      {stayId !== null ? (
        <DocumentsSection entry={{ type: "lodgingStay", id: stayId }} extract={extract} />
      ) : null}
    </>
  );
}
