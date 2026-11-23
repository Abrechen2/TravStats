import { useState } from "react";
import type { JSX } from "react";

import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import CoverSuggestDialog from "./CoverSuggestDialog";

/**
 * A quiet line on a trip that has no cover yet: "Deckblatt vorschlagen". It
 * only opens the dialog — the suggestions are read when asked for, never in
 * the background — and it is absent for the shared demo account.
 */
export default function CoverSuggestPrompt({
  tripId,
  onChosen,
  label = "cover.prompt",
  testId = "cover-suggest-prompt",
}: {
  tripId: string;
  onChosen: () => void;
  /** Translation key of the line; "cover.unavailable" when the current cover no longer loads. */
  label?: string;
  testId?: string;
}): JSX.Element | null {
  const { t } = useTranslation("immich");
  const isSharedDemo = useIsDemoAccount();
  const [open, setOpen] = useState(false);
  if (isSharedDemo) return null;
  return (
    <>
      <button
        type="button"
        className="t-caption self-start underline"
        style={{ minHeight: "var(--ts-size-touch-min)", color: "var(--ts-muted)" }}
        data-testid={testId}
        onClick={() => setOpen(true)}
      >
        {t(label)}
      </button>
      {open && (
        <CoverSuggestDialog tripId={tripId} onClose={() => setOpen(false)} onChosen={onChosen} />
      )}
    </>
  );
}
