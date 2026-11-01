import { useState } from "react";
import type { JSX } from "react";

import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import type { ShareLinkKind } from "../../types/shareLinks";
import Button from "../ui/Button";
import ShareLinkDialog from "./ShareLinkDialog";

/**
 * The "Als Link teilen" button on a flight, a trip, the year in review, a cruise,
 * a lodging stay and a place visit
 * (forgejo#281). Not for the shared demo account — every visitor of a public
 * instance at once — whose links would be anyone's; the server refuses it too.
 */
export default function ShareLinkButton({
  kind,
  targetId,
  variant = "button",
}: {
  kind: ShareLinkKind;
  targetId: string;
  /** `link` is the quiet text form for a card or row that already has small text actions. */
  variant?: "button" | "link";
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const isSharedDemo = useIsDemoAccount();
  const [open, setOpen] = useState(false);
  if (isSharedDemo) return null;
  return (
    <>
      {variant === "link" ? (
        <button
          type="button"
          data-testid={`share-link-${kind}-${targetId}`}
          onClick={() => setOpen(true)}
          className="text-xs text-[var(--accent)] hover:underline pointer-coarse:min-h-(--ts-size-touch-min)"
        >
          {t("sharing:links.button")}
        </button>
      ) : (
        <Button onClick={() => setOpen(true)}>{t("sharing:links.button")}</Button>
      )}
      {open && (
        <ShareLinkDialog
          open={open}
          onClose={() => setOpen(false)}
          kind={kind}
          targetId={targetId}
        />
      )}
    </>
  );
}
