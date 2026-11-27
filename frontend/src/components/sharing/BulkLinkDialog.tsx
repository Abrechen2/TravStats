import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingLinkApi } from "../../lib/api/sharingLink";
import type { PersonEntry } from "../Settings/people/buildPeople";
import { Dialog } from "../ui";
import BulkLinkPanel from "./BulkLinkPanel";
import BulkOfferPanel from "./BulkOfferPanel";
import { sharingErrorKey } from "./sharingCopy";

/**
 * The bulk link from a person's row (UAT 2026-11-27): an account on this server links every
 * matching trip pair at once; a person on another server gets the trips they travelled on
 * offered at once, and links them in their own inbox.
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
      title={t(account.kind === "local" ? "sharing:bulk.title" : "sharing:bulk.offer.title", {
        name: person.name,
      })}
    >
      {account.kind === "local" && (
        <BulkLinkPanel
          otherName={person.name}
          loadPairs={() => sharingLinkApi.bulkPairs(account.userId)}
          preview={(pair) => sharingLinkApi.preview(pair.id, account.userId, pair.other.id)}
          link={(pair, decision, choices) =>
            sharingLinkApi.link(pair.id, account.userId, pair.other.id, decision, choices)
          }
          undo={(pair) => sharingLinkApi.leave(pair.id)}
          failure={(err, fallback) => ({ key: sharingErrorKey(err, fallback) })}
        />
      )}
      {account.kind === "remote" && remoteId && (
        <BulkOfferPanel remoteId={remoteId} name={person.name} />
      )}
    </Dialog>
  );
}
