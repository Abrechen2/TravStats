import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { PersonEntry } from "../Settings/people/buildPeople";
import { Dialog } from "../ui";
import BulkOfferPanel from "./BulkOfferPanel";
import BulkProposePanel from "./BulkProposePanel";

/**
 * The bulk step from a person's row (UAT 2026-11-27, Codex P1): the caller's trips the person
 * travelled on are proposed (an account here) or offered (a person on another server) at once;
 * the person links the matching ones in their own inbox.
 */
export default function BulkLinkDialog({
  person,
  onClose,
}: {
  person: PersonEntry;
  onClose: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const account = person.account;
  if (!account) return null;
  const remoteId = person.connection?.id;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t(
        account.kind === "local" ? "sharing:bulk.propose.title" : "sharing:bulk.offer.title",
        {
          name: person.name,
        }
      )}
    >
      {account.kind === "local" && <BulkProposePanel userId={account.userId} name={person.name} />}
      {account.kind === "remote" && remoteId && (
        <BulkOfferPanel remoteId={remoteId} name={person.name} />
      )}
    </Dialog>
  );
}
