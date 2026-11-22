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
}: {
  tripId: string;
  onChosen: () => void;
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
        data-testid="cover-suggest-prompt"
        onClick={() => setOpen(true)}
      >
        {t("cover.prompt")}
      </button>
      {open && (
        <CoverSuggestDialog tripId={tripId} onClose={() => setOpen(false)} onChosen={onChosen} />
      )}
    </>
  );
}
