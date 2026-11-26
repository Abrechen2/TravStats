import { useEffect, useState } from "react";
import { EmptyState } from "../../components/ui";
import ConfirmModal from "../../components/ui/ConfirmModal";
import InlineError from "../../components/ui/InlineError";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";
import { useTranslation } from "../../hooks/useTranslation";
import { travplanApi, type PlanDeletePreview } from "../../lib/api/travplan";
import { PlanNotice } from "./planLayout";

const REMOVED: (keyof PlanDeletePreview["removes"])[] = [
  "stations",
  "stages",
  "variants",
  "items",
  "ideas",
  "bookings",
  "tasks",
  "packing",
  "receipts",
  "proposals",
];

/**
 * The confirmation for deleting a plan: what goes (measured by the server, not guessed here) and
 * what stays. The action is withheld until the preview has arrived - a delete that cannot say what
 * it deletes is not offered.
 */
export function PlanDeleteDialog({
  tripId,
  name,
  onClose,
  onDeleted,
}: {
  tripId: string;
  name: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation("travplan"),
    [preview, setPreview] = useState<PlanDeletePreview | null>(null),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    travplanApi
      .deletePreview(tripId)
      .then((p) => live && setPreview(p))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [tripId]);
  async function remove() {
    setBusy(true);
    setError(false);
    try {
      await travplanApi.deletePlan(tripId);
      onDeleted();
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  const counted = preview ? REMOVED.filter((k) => preview.removes[k] > 0) : [];
  return (
    <ConfirmModal
      isOpen
      onClose={onClose}
      onConfirm={() => void remove()}
      isLoading={busy}
      confirmDisabled={!preview}
      title={t("deletePlan.title", { name })}
      confirmText={t("deletePlan.confirm")}
      confirmButtonClass={DELETE_BUTTON_CLASS}
      cancelText={t("cancel")}
    >
      {!preview && !failed && <EmptyState kind="pending" title={t("loading")} />}
      {failed && <PlanNotice tone="bad">{t("deletePlan.previewFailed")}</PlanNotice>}
      {preview && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          <div>
            <h3 className="t-card-title">{t("deletePlan.removes")}</h3>
            {counted.length ? (
              <ul
                className="t-body"
                style={{ paddingLeft: "var(--ts-space-xl)", listStyle: "disc" }}
              >
                {counted.map((k) => (
                  <li key={k}>{t("deletePlan.what." + k, { count: preview.removes[k] })}</li>
                ))}
              </ul>
            ) : (
              <p className="t-body">{t("deletePlan.nothing")}</p>
            )}
          </div>
          <div>
            <h3 className="t-card-title">{t("deletePlan.stays")}</h3>
            <p className="t-body">{t("deletePlan.staysBody")}</p>
            {preview.keeps.stations > 0 && (
              <p className="t-body">
                {t("deletePlan.staysStations", { count: preview.keeps.stations })}
              </p>
            )}
            {preview.tripIsEmptyShell && <p className="t-caption">{t("deletePlan.shell")}</p>}
          </div>
          <p className="t-caption">{t("deletePlan.undoNote")}</p>
        </div>
      )}
      {error && <InlineError>{t("deletePlan.failed")}</InlineError>}
    </ConfirmModal>
  );
}
