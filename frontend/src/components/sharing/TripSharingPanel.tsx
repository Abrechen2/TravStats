import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { ShareCandidate, TripSharing } from "../../types/sharing";
import Button from "../ui/Button";
import DetailSection from "../ui/DetailSection";
import { sharingErrorKey } from "./sharingCopy";

const NS = "sharing:trip";

/**
 * "Geteilt" on the trip overview (design 2026-10-09, decision 5): who else
 * holds this trip, a share tick per linked companion, and leaving the group.
 *
 * A tick that is set cannot be unset here — un-sharing is not a thing in S1;
 * the other member leaves on their side, which keeps their copy. A companion
 * whose account has not agreed shows a disabled tick and says why, rather than
 * a tick that fails on click. A failed load is said as such, not hidden.
 */
export default function TripSharingPanel({
  tripId,
  onChanged,
}: {
  tripId: string;
  /** The trip's own data may change (leaving clears its group). */
  onChanged?: () => void;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const addToast = useToastStore((state) => state.addToast);
  const { confirm, confirmDialog } = useConfirmDialog();
  const [view, setView] = useState<TripSharing | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await sharingApi.tripSharing(tripId));
      setLoadFailed(false);
    } catch (error) {
      logger.error("Failed to load trip sharing:", error);
      setLoadFailed(true);
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const share = async (candidate: ShareCandidate): Promise<void> => {
    setBusy(candidate.companionId);
    try {
      await sharingApi.shareTrip(tripId, candidate.companionId);
      addToast("success", t(`${NS}.shared`, { name: candidate.user.displayName }));
      await load();
      onChanged?.();
    } catch (error) {
      logger.error("Failed to share trip:", error);
      addToast("error", t(sharingErrorKey(error, `${NS}.errors.shareFailed`)));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const leave = async (): Promise<void> => {
    if (!(await confirm({ message: t(`${NS}.leaveConfirm`), confirmText: t(`${NS}.leave`) }))) {
      return;
    }
    setBusy("leave");
    try {
      await sharingApi.leaveGroup(tripId);
      addToast("success", t(`${NS}.left`));
      await load();
      onChanged?.();
    } catch (error) {
      logger.error("Failed to leave share group:", error);
      addToast("error", t(sharingErrorKey(error, `${NS}.errors.leaveFailed`)));
    } finally {
      setBusy(null);
    }
  };

  if (loadFailed) {
    return (
      <DetailSection title={t(`${NS}.title`)}>
        <p role="alert" className="text-sm" style={{ color: "var(--ts-warn)" }}>
          {t(`${NS}.errors.loadFailed`)}
        </p>
      </DetailSection>
    );
  }
  if (!view) return <></>;

  const memberIds = new Set(view.members.map((m) => m.id));
  return (
    <>
      <DetailSection title={t(`${NS}.title`)}>
        <div className="flex flex-col gap-3 text-sm">
          {view.members.length > 0 ? (
            <p data-testid="share-members">
              {t(`${NS}.members`)}: {view.members.map((m) => m.displayName).join(", ")}
            </p>
          ) : (
            <p className="t-caption">{t(`${NS}.notShared`)}</p>
          )}

          {view.candidates.length === 0 ? (
            <p className="t-caption">
              {t(`${NS}.noCandidates`)}{" "}
              <Link to="/settings?section=trips">{t(`${NS}.settingsLink`)}</Link>
            </p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label={t(`${NS}.candidates`)}>
              {view.candidates.map((c) => {
                const shared = c.shared || memberIds.has(c.user.id);
                const label = t(shared ? `${NS}.sharedTick` : `${NS}.shareTick`, {
                  name: c.name,
                });
                return (
                  <li key={c.companionId}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={shared}
                        disabled={shared || !c.consenting || busy !== null}
                        onChange={() => void share(c)}
                      />
                      <span>{label}</span>
                    </label>
                    {!c.consenting && !shared && (
                      <p className="t-caption ml-6">{t(`${NS}.noConsent`, { name: c.name })}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <p className="t-caption">{t(`${NS}.privateHint`)}</p>

          {view.groupId && (
            <div>
              <Button disabled={busy !== null} onClick={() => void leave()}>
                {t(`${NS}.leave`)}
              </Button>
            </div>
          )}
        </div>
      </DetailSection>
      {confirmDialog}
    </>
  );
}
