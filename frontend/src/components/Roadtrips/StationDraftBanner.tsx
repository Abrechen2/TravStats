import { useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import ConfirmModal from "../Training/ConfirmModal";
import { useTranslation } from "../../hooks/useTranslation";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { StoredStationDraft } from "../../lib/roadtrip/stationDraftStore";

/**
 * "You have station changes on this device the server never got" (forgejo#244),
 * shown on the roadtrip page when a local draft from an earlier visit is
 * waiting. Restore opens the editor with it — through the conflict check when
 * the server moved on meanwhile; discard asks first, because it is the only
 * copy those edits have.
 */
export default function StationDraftBanner({
  draft,
  onRestore,
  onDiscard,
}: {
  draft: StoredStationDraft;
  onRestore: () => void;
  onDiscard: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  const display = useDisplayFormat();
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      role="status"
      className="flex flex-col"
      style={{
        gap: 10,
        padding: 14,
        marginBottom: 12,
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface)",
        border: "1px solid color-mix(in srgb, var(--ts-warn) 45%, transparent)",
      }}
    >
      <span style={{ fontWeight: 700 }}>{t("roadtrips:draft.title")}</span>
      <span className="t-caption">
        {t("roadtrips:draft.body", {
          when: display.dateTime(draft.savedAt),
          count: draft.drafts.length,
        })}
      </span>
      <div className="flex flex-wrap" style={{ gap: 8 }}>
        <Button variant="primary" onClick={onRestore}>
          {t("roadtrips:draft.restore")}
        </Button>
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          {t("roadtrips:draft.discard")}
        </Button>
      </div>
      {confirming && (
        <ConfirmModal
          isOpen
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onDiscard();
          }}
          title={t("roadtrips:draft.discardTitle")}
          message={t("roadtrips:draft.discardMessage")}
          confirmText={t("roadtrips:draft.discardConfirm")}
          confirmButtonClass={DELETE_BUTTON_CLASS}
        />
      )}
    </div>
  );
}
