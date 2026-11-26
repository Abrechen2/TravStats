import DateField from "../../components/ui/DateField";
import { useState } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import {
  provenanceApi,
  type Provenance,
  type ProvenanceEntryType,
  type ProvenanceState,
} from "../../lib/api/provenance";
import { logger } from "../../lib/logger";
import { Button } from "../ui";
import InlineError from "../ui/InlineError";

const NOTE_MAX = 500;
type Choice = "unknown" | Provenance;

/**
 * Where an entry's information comes from: unknown, documented, or "aus der Erinnerung" (with
 * the day it was written down and the user's own words). Saved on its own through
 * `PUT /provenance/…` — the entry's own form is untouched. A failed save says so in place.
 */
export default function RememberedEditor({
  entryType,
  entryId,
  initial,
  onSaved,
}: {
  entryType: ProvenanceEntryType;
  entryId: string;
  initial: Partial<ProvenanceState> | null | undefined;
  onSaved?: (state: ProvenanceState) => void;
}): JSX.Element {
  const { t } = useTranslation(["provenance"]);
  const [choice, setChoice] = useState<Choice>(initial?.provenance ?? "unknown");
  const [on, setOn] = useState(initial?.rememberedOn?.slice(0, 10) ?? "");
  const [note, setNote] = useState(initial?.rememberedNote ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);

  const save = async (): Promise<void> => {
    setBusy(true);
    setStatus(null);
    const remembered = choice === "remembered";
    try {
      const state = await provenanceApi.set(entryType, entryId, {
        provenance: choice === "unknown" ? null : choice,
        rememberedOn: remembered && on ? on : null,
        rememberedNote: remembered && note.trim() ? note.trim() : null,
      });
      setStatus("saved");
      onSaved?.(state);
    } catch (err) {
      logger.warn("Failed to save the provenance of an entry:", err);
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <legend style={{ fontWeight: 600, color: "var(--ts-text)" }}>
        {t("provenance:editor.legend")}
      </legend>
      {(["unknown", "recorded", "remembered"] as const).map((c) => (
        <label key={c} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`provenance-${entryId}`}
            checked={choice === c}
            onChange={() => setChoice(c)}
          />
          {t(`provenance:editor.${c}`)}
        </label>
      ))}
      {choice === "remembered" && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          <p className="t-caption">{t("provenance:editor.hint")}</p>
          <label className="flex flex-col text-sm" style={{ gap: 4 }}>
            {t("provenance:editor.rememberedOn")}
            <DateField value={on} onChange={(e) => setOn(e.target.value)} />
          </label>
          <label className="flex flex-col text-sm" style={{ gap: 4 }}>
            {t("provenance:editor.note")}
            <textarea
              rows={2}
              maxLength={NOTE_MAX}
              value={note}
              placeholder={t("provenance:editor.notePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => void save()}>
          {t("provenance:editor.save")}
        </Button>
        {status === "saved" && (
          <span className="t-caption" role="status">
            {t("provenance:editor.saved")}
          </span>
        )}
        {status === "error" && (
          <InlineError tone="warning">{t("provenance:editor.error")}</InlineError>
        )}
      </div>
    </fieldset>
  );
}
