import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { purposeApi, type PurposeEntryType } from "../../lib/api/purpose";
import { logger } from "../../lib/logger";
import PurposeSelect, { PURPOSE_UNSET, toChoice, type PurposeChoice } from "./PurposeSelect";

/**
 * The purpose of one stored entry, saved as soon as it is chosen (a detail page has no form to
 * submit). A failed save is said out loud and the field goes back to what is stored.
 */
export default function PurposeEditor({
  entryType,
  entryId,
  purpose,
  onSaved,
}: {
  entryType: PurposeEntryType;
  entryId: string;
  purpose: string | null | undefined;
  onSaved?: (purpose: string | null) => void;
}): JSX.Element {
  const { t } = useTranslation(["purpose"]);
  const [stored, setStored] = useState<PurposeChoice>(toChoice(purpose));
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  const choose = async (next: PurposeChoice): Promise<void> => {
    setStatus("idle");
    try {
      const saved = await purposeApi.set(entryType, entryId, next === PURPOSE_UNSET ? null : next);
      setStored(toChoice(saved));
      setStatus("saved");
      onSaved?.(saved);
    } catch (error) {
      logger.warn("purpose save failed", error);
      setStatus("error");
    }
  };

  return (
    <div>
      <PurposeSelect id={`purpose-${entryId}`} value={stored} onChange={(v) => void choose(v)} />
      <p className="t-caption">{t("purpose:field.hint")}</p>
      {status !== "idle" && (
        <p role={status === "error" ? "alert" : "status"} className="t-caption">
          {status === "saved" ? t("purpose:editor.saved") : t("purpose:editor.error")}
        </p>
      )}
    </div>
  );
}
