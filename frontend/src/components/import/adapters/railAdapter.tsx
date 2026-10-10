import type { JSX } from "react";
import { useEffect } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";
import type { ParseEmailRailResult, ParsePdfRailResult } from "../../../lib/api/parse";
import { RailFormModal } from "../../rail/RailFormModal";
import { RailImportPreviewModal } from "../../rail/RailImportPreviewModal";
import { RailReservationReviewModal } from "../../rail/RailReservationReviewModal";
import { emptyParseMessageKey } from "../../rail/railImportModel";
import { RailShareLinkRoute } from "../../rail/RailShareLinkRoute";
import { isRailShareLinkPrefill } from "../../rail/railShareLinkModel";
import type { DomainImportAdapter, ReviewModalProps } from "../types";

type RailParse = ParseEmailRailResult | ParsePdfRailResult;

/**
 * What the rail add dialog takes besides a PDF (the panel adds ".pdf" to every
 * domain). Exported so the rail page's copy can be held to it: the page once
 * promised calendar files the file picker did not even list (forgejo#162). A
 * calendar file is read only as an attachment of a booking mail.
 */
export const RAIL_ACCEPTED_EMAIL_EXTENSIONS: readonly string[] = [".eml", ".msg", ".txt"];

function extractRailParse(result: unknown): RailParse | null {
  if (typeof result !== "object" || result === null) return null;
  const r = result as Partial<RailParse>;
  return r.domain === "rail" && Array.isArray(r.bookings) ? (r as RailParse) : null;
}

/**
 * Plugs rail into `<DomainImportPanel>`: a DB (or any) ticket mail, .eml/.msg
 * with its attachments, or a PDF → the parsed legs → the review, where each
 * leg is confirmed before anything is written. Behind the `railDomain` beta
 * gate like the rest of rail — only a rail surface mounts it.
 */
export function useRailImportAdapter(): DomainImportAdapter {
  const { t } = useTranslation(["rail", "import"]);
  const addToast = useToastStore((s) => s.addToast);

  return {
    domain: "rail",
    panelTitle: t("rail:import.panelTitle"),
    panelHint: t("rail:import.panelHint"),
    acceptedEmailExtensions: [...RAIL_ACCEPTED_EMAIL_EXTENSIONS],
    routes: [
      {
        id: "railShareLink",
        icon: "🔗",
        title: t("rail:shareLink.title"),
        description: t("rail:shareLink.description"),
        render: (context) => <RailShareLinkRoute context={context} />,
      },
    ],
    renderManual: ({ onClose, onSaved, onProgress, prefill }) => (
      <RailFormModal
        journey={null}
        // A share link that could not be read still hands on what it said.
        initialDraft={isRailShareLinkPrefill(prefill) ? prefill.draft : undefined}
        onClose={onClose}
        onSaved={async () => {
          await onSaved();
        }}
        // A leg stored by "save and add a connection" shows in the list at
        // once, so a cancelled next leg leaves nothing missing behind.
        onProgress={async () => {
          await onProgress?.();
        }}
      />
    ),
    renderReviewModal: (props) => (
      <RailReviewSlot
        {...props}
        onEmpty={(message) => addToast("error", message)}
        onDone={(count) => addToast("success", t("rail:import.saved", { count }))}
        onReservationDone={(count) =>
          addToast("success", t("rail:import.reservation.done", { count }))
        }
      />
    ),
  };
}

interface RailReviewSlotProps extends ReviewModalProps {
  onEmpty: (message: string) => void;
  onDone: (count: number) => void;
  onReservationDone: (count: number) => void;
}

function RailReviewSlot({
  parseResult,
  onCommit,
  onCancel,
  onEmpty,
  onDone,
  onReservationDone,
}: RailReviewSlotProps): JSX.Element | null {
  const { t } = useTranslation(["rail"]);
  const parsed = extractRailParse(parseResult);
  const booking = parsed?.bookings[0] ?? null;

  // Nothing read: say WHY in the reader's words (the server sends a code),
  // and hand the user back to the chooser, where "enter by hand" waits.
  useEffect(() => {
    if (booking && booking.legs.length > 0) return;
    if (parsed?.fallbackReason) logger.warn("RailReviewSlot: nothing read", parsed.fallbackReason);
    onEmpty(
      t(emptyParseMessageKey(parsed?.fallbackCode), { reference: parsed?.orderReference ?? "" })
    );
    onCancel();
    // One parse, one slot: re-running on a new callback identity would toast twice.
  }, [parseResult]);

  if (!booking || booking.legs.length === 0) return null;
  // A reservation booked after the ticket writes no journey: its seats go onto
  // the journeys already logged (forgejo#203).
  if (booking.documentKind === "reservation") {
    return (
      <RailReservationReviewModal
        booking={booking}
        onCancel={onCancel}
        onSaved={async (count) => {
          onReservationDone(count);
          await onCommit();
        }}
      />
    );
  }
  return (
    <RailImportPreviewModal
      booking={booking}
      onCancel={onCancel}
      onSaved={async (count) => {
        onDone(count);
        await onCommit();
      }}
    />
  );
}
