import { useState } from "react";
import type { JSX } from "react";

import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import type { CreatableShareLinkKind } from "../../types/shareLinks";
import Button from "../ui/Button";
import ShareLinkDialog from "./ShareLinkDialog";

/**
 * The "Als Link teilen" button on the year in review (forgejo#281); a trip
 * opens the same dialog from its share menu. Single flights, cruises, stays
 * and visits are no longer shared on their own (owner decision 2026-11-22).
 * Not for the shared demo account — every visitor of a public instance at
 * once — whose links would be anyone's; the server refuses it too.
 */
export default function ShareLinkButton({
  kind,
  targetId,
}: {
  kind: CreatableShareLinkKind;
  targetId: string;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const isSharedDemo = useIsDemoAccount();
  const [open, setOpen] = useState(false);
  if (isSharedDemo) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("sharing:links.button")}</Button>
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
