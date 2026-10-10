import { useEffect, useState } from "react";
import type { JSX } from "react";

import { Field, Input, Select } from "../ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import { companionsApi, type Companion } from "../../lib/api/companions";
import { logger } from "../../lib/logger";
import type { ExpenseDraft } from "./expenseDraft";

export const PAYER_ID = "expense-payer";
export const PAYER_NAME_ID = "expense-payer-name";

const COMPANION_PREFIX = "companion:";

type PayerPatch = Pick<ExpenseDraft, "payerMode" | "payerCompanionId" | "payerName">;

/**
 * Who paid (forgejo#150): one of the reader's own companions, a name typed for
 * a one-off payer, or nobody recorded. It records who paid and nothing more —
 * the cost is not split, and the hint says so, because "Bezahlt von" beside a
 * travel party reads easily like the start of a settle-up.
 *
 * A companion list that fails to load is said, not hidden: the picker would
 * otherwise look like an account without companions. A typed name still works.
 */
export default function ExpensePayerField({
  draft,
  onChange,
  nameError,
}: {
  draft: ExpenseDraft;
  onChange: (patch: Partial<PayerPatch>) => void;
  /** Set when the name mode holds no name. */
  nameError?: string;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const [companions, setCompanions] = useState<Companion[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await companionsApi.list();
        if (!cancelled) setCompanions(list);
      } catch (err: unknown) {
        logger.warn("Loading companions for the payer picker failed", err);
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected =
    draft.payerMode === "companion"
      ? `${COMPANION_PREFIX}${draft.payerCompanionId}`
      : draft.payerMode;
  // The recorded companion stays selectable while the list loads, or when it failed.
  const recordedMissing =
    draft.payerMode === "companion" &&
    !(companions ?? []).some((c) => c.id === draft.payerCompanionId);

  const pick = (value: string): void => {
    if (value.startsWith(COMPANION_PREFIX)) {
      const id = value.slice(COMPANION_PREFIX.length);
      const name = companions?.find((c) => c.id === id)?.name ?? draft.payerName;
      onChange({ payerMode: "companion", payerCompanionId: id, payerName: name });
    } else if (value === "name") {
      // A companion's name is a fine start for a typed one; "nobody" is not.
      onChange({
        payerMode: "name",
        payerCompanionId: "",
        payerName: draft.payerMode === "none" ? "" : draft.payerName,
      });
    } else {
      onChange({ payerMode: "none", payerCompanionId: "", payerName: "" });
    }
  };

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <Field label={t("roadtrips:costs.payer.label")} htmlFor={PAYER_ID}>
        <Select
          id={PAYER_ID}
          value={selected}
          aria-describedby={`${PAYER_ID}-hint`}
          onChange={(e) => pick(e.target.value)}
        >
          <option value="none">{t("roadtrips:costs.payer.none")}</option>
          {recordedMissing && (
            <option value={selected}>
              {draft.payerName || t("roadtrips:costs.payer.unknown")}
            </option>
          )}
          {(companions ?? []).map((c) => (
            <option key={c.id} value={`${COMPANION_PREFIX}${c.id}`}>
              {c.name}
            </option>
          ))}
          <option value="name">{t("roadtrips:costs.payer.other")}</option>
        </Select>
      </Field>
      <span id={`${PAYER_ID}-hint`} className="t-caption">
        {t("roadtrips:costs.payer.hint")}
      </span>
      {loadFailed && (
        <span className="t-caption" role="status" style={{ color: "var(--ts-warn)" }}>
          {t("roadtrips:costs.payer.loadFailed")}
        </span>
      )}
      {draft.payerMode === "name" && (
        <Field label={t("roadtrips:costs.payer.name")} htmlFor={PAYER_NAME_ID} error={nameError}>
          <Input
            id={PAYER_NAME_ID}
            aria-required="true"
            maxLength={100}
            value={draft.payerName}
            invalid={nameError !== undefined}
            onChange={(e) => onChange({ payerName: e.target.value })}
          />
        </Field>
      )}
    </div>
  );
}
