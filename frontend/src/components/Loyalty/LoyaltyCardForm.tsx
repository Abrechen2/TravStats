import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { createLoyaltyMembership, updateLoyaltyMembership } from "../../lib/api/loyalty";
import { logger } from "../../lib/logger";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import type { LoyaltyMembership, LoyaltyMembershipInput } from "../../types/loyalty";
import AlliancePicker from "./AlliancePicker";
import ValueChips from "./ValueChips";
import { coverageField, coverageOf, type CardDomain } from "./cardCoverage";

export type { CardDomain } from "./cardCoverage";

/** What a new card starts with — empty, or a suggestion taken over from the flights. */
export interface CardPrefill {
  programName: string;
  membershipNumber: string;
  coverage: string[];
}

interface Props {
  domain: CardDomain;
  /** The card being edited; absent creates one. */
  card?: LoyaltyMembership;
  prefill?: CardPrefill;
  /** Offered while typing a coverage value (the cruise lines the logbook uses). */
  coverageOptions?: string[];
  onSaved: () => void;
  onCancel: () => void;
}

const IATA_AIRLINE = /^[A-Z0-9]{2}$/;

/**
 * Create or edit a frequent-flyer, cruise-line or rail card. One form for all:
 * the card is the same thing, and only what it covers differs — IATA codes for
 * an airline programme, line names for a cruise club, operators for a rail
 * programme.
 */
export default function LoyaltyCardForm({
  domain,
  card,
  prefill,
  coverageOptions,
  onSaved,
  onCancel,
}: Props): JSX.Element {
  const { t } = useTranslation(["loyalty", "common"]);
  const [programName, setProgramName] = useState(card?.programName ?? prefill?.programName ?? "");
  const [membershipNumber, setMembershipNumber] = useState(
    card?.membershipNumber ?? prefill?.membershipNumber ?? ""
  );
  const [tier, setTier] = useState(card?.tier ?? "");
  const [notes, setNotes] = useState(card?.notes ?? "");
  const [coverage, setCoverage] = useState<string[]>(
    card ? coverageOf(domain, card) : (prefill?.coverage ?? [])
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptCoverage = (raw: string): string | null => {
    const value = raw.trim();
    if (domain !== "flight") return value || null;
    const code = value.toUpperCase();
    return IATA_AIRLINE.test(code) ? code : null;
  };

  const submit = async (): Promise<void> => {
    if (programName.trim() === "") return;
    const input: LoyaltyMembershipInput = {
      programName: programName.trim(),
      membershipNumber: membershipNumber.trim() || null,
      tier: tier.trim() || null,
      notes: notes.trim() || null,
      [coverageField(domain)]: coverage,
    };
    setSaving(true);
    setError(null);
    try {
      if (card) await updateLoyaltyMembership(card.id, input);
      else await createLoyaltyMembership(domain, input);
      onSaved();
    } catch (err: unknown) {
      logger.error("LoyaltyCardForm: save failed", err);
      setError(
        saveErrorMessage(err, t, "loyalty:saveError", { DUPLICATE: "loyalty:duplicateError" })
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="space-y-3"
      data-testid={`loyalty-form-${domain}`}
      style={{ borderTop: "1px solid var(--ts-border)", paddingTop: "var(--ts-space-lg)" }}
    >
      <input
        aria-label={t("loyalty:field.programName")}
        placeholder={t("loyalty:field.programName")}
        value={programName}
        onChange={(e) => setProgramName(e.target.value)}
        className="input"
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          aria-label={t("loyalty:field.membershipNumber")}
          placeholder={t("loyalty:field.membershipNumber")}
          value={membershipNumber}
          onChange={(e) => setMembershipNumber(e.target.value)}
          className="input"
          autoComplete="off"
        />
        <input
          aria-label={t("loyalty:field.tier")}
          placeholder={t("loyalty:field.tier")}
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="input"
        />
      </div>
      <ValueChips
        testId={`loyalty-coverage-${domain}`}
        label={t(`loyalty:field.${coverageField(domain)}`)}
        hint={t(`loyalty:field.${coverageField(domain)}Hint`)}
        invalidMessage={domain === "flight" ? t("loyalty:field.invalidCode") : undefined}
        values={coverage}
        onChange={setCoverage}
        accept={acceptCoverage}
        options={coverageOptions}
      />
      {domain === "flight" && <AlliancePicker values={coverage} onChange={setCoverage} />}
      <textarea
        aria-label={t("loyalty:field.notes")}
        placeholder={t("loyalty:field.notes")}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="input"
        rows={2}
      />
      {error !== null && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="btn-secondary">
          {t("common:buttons.cancel")}
        </button>
        <button
          type="button"
          data-testid={`loyalty-save-${domain}`}
          disabled={saving || programName.trim() === ""}
          onClick={() => void submit()}
          className="btn-primary"
        >
          {saving ? t("common:buttons.saving") : t("common:buttons.save")}
        </button>
      </div>
    </div>
  );
}
