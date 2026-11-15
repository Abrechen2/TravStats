import { useState } from "react";
import { railApi } from "../../lib/api/rail";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import type { useFormFailure, useSaveOnce } from "../form";
import type { RailJourney } from "../../types/rail";
import {
  geometryNotice,
  invalidRailPrice,
  saveErrorFrom,
  toRailInput,
  type RailFormDraft,
  type RailSaveError,
} from "./railFormModel";

/** A notice about the line is read, not glanced at — longer than a "saved". */
const NOTICE_MS = 12_000;

interface Args {
  draft: RailFormDraft;
  journey: RailJourney | null;
  previousId: string | undefined;
  ready: boolean;
  failure: ReturnType<typeof useFormFailure>;
  saving: ReturnType<typeof useSaveOnce<RailJourney>>;
  markSaved: () => void;
  onSaved: (saved: RailJourney) => void | Promise<void>;
  onProgress?: (saved: RailJourney) => void | Promise<void>;
  continueAfter: (saved: RailJourney) => void;
}

/** The save of the rail form: both buttons, the refusal it leaves and the retry of the last one. */
export function useRailSubmit({
  draft,
  journey,
  previousId,
  ready,
  failure,
  saving,
  markSaved,
  onSaved,
  onProgress,
  continueAfter,
}: Args) {
  const { t } = useTranslation(["rail", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  /** The last refusal; shown only while `failure` still holds it (until the next edit). */
  const [refusal, setRefusal] = useState<RailSaveError | null>(null);
  /** Which button the refused save came from, so "Erneut versuchen" repeats it. */
  const [retryConnect, setRetryConnect] = useState(false);
  /** "Save and add a connection" stored the leg, but the list did not reload. */
  const [progressRefreshFailed, setProgressRefreshFailed] = useState(false);

  const submit = async (thenConnect = false): Promise<void> => {
    if (!ready) return;
    failure.clear();
    setRetryConnect(thenConnect);
    setProgressRefreshFailed(false);
    if (invalidRailPrice(draft)) {
      setRefusal({ key: "rail:form.errors.invalidPrice", field: "price" });
      failure.fail("rail:form.errors.invalidPrice");
      return;
    }
    const input = toRailInput(draft);
    // The request and what follows are two steps (forgejo#247): a list that
    // fails to reload must not turn a stored ride into "nicht gespeichert" —
    // the next click would have created it twice.
    const outcome = await saving.save(
      async () => {
        const result = journey
          ? await railApi.update(journey.id, input)
          : await railApi.create(previousId ? { ...input, connectsFrom: previousId } : input);
        const notice = geometryNotice(result.geometry);
        if (notice) {
          addToast(notice.level, t(notice.key, { reason: t(notice.reasonKey) }), NOTICE_MS);
        }
        return result.journey;
      },
      async (saved) => {
        markSaved();
        if (!thenConnect) {
          await onSaved(saved);
          return;
        }
        // The next leg opens either way: the ride IS stored, only the list
        // behind the dialog is stale — said, not treated as a refusal.
        try {
          await onProgress?.(saved);
        } catch (err: unknown) {
          logger.error("RailFormModal: list not refreshed after a leg", err);
          setProgressRefreshFailed(true);
        }
      }
    );
    if (outcome.status === "failed") {
      logger.error("RailFormModal: save failed", outcome.error);
      const refused = saveErrorFrom(outcome.error, { create: !journey });
      setRefusal(refused);
      failure.fail(refused.key);
      return;
    }
    if (thenConnect && outcome.status === "saved") continueAfter(outcome.value);
  };

  return { submit, refusal, retryConnect, progressRefreshFailed };
}
