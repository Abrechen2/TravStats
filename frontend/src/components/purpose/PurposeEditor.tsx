import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { purposeApi, type PurposeEntryType, type StoredPurpose } from "../../lib/api/purpose";
import { logger } from "../../lib/logger";
import { usePurposeCatalogue } from "../../store/purposeCatalogueStore";
import PurposeSelect, { PURPOSE_UNSET, toChoice, type PurposeChoice } from "./PurposeSelect";

/**
 * The purpose of one stored entry, saved as soon as it is chosen (a detail page has no form to
 * submit). A failed save is said out loud and the field goes back to what is stored.
 */
export default function PurposeEditor({
  entryType,
  entryId,
  purpose,
  purposeKey,
  onSaved,
}: {
  entryType: PurposeEntryType;
  entryId: string;
  purpose: string | null | undefined;
  purposeKey?: string | null;
  onSaved?: (stored: StoredPurpose) => void;
}): JSX.Element {
  const { t } = useTranslation(["purpose"]);
  const catalogue = usePurposeCatalogue();
  const [stored, setStored] = useState<StoredPurpose | null>(null);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const current = stored ?? {
    purpose: (purpose ?? null) as StoredPurpose["purpose"],
    purposeKey: purposeKey ?? null,
  };

  const choose = async (next: PurposeChoice): Promise<void> => {
    setStatus("idle");
    try {
      const saved = await purposeApi.set(entryType, entryId, next === PURPOSE_UNSET ? null : next);
      setStored(saved);
      setStatus("saved");
      onSaved?.(saved);
    } catch (error) {
      logger.warn("purpose save failed", error);
      setStatus("error");
    }
  };

  return (
    <div>
      <PurposeSelect
        id={`purpose-${entryId}`}
        value={toChoice(catalogue, current)}
        onChange={(v) => void choose(v)}
      />
      <p className="t-caption">{t("purpose:field.hint")}</p>
      {status !== "idle" && (
        <p role={status === "error" ? "alert" : "status"} className="t-caption">
          {status === "saved" ? t("purpose:editor.saved") : t("purpose:editor.error")}
        </p>
      )}
    </div>
  );
}
