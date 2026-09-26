import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { deleteLoyaltyMembership } from "../../lib/api/loyalty";
import { logger } from "../../lib/logger";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import type { LoyaltyMembership } from "../../types/loyalty";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";
import ActivityLine from "./ActivityLine";
import FrequentFlyerSuggestions from "./FrequentFlyerSuggestions";
import LoyaltyCardForm, { type CardDomain, type CardPrefill } from "./LoyaltyCardForm";
import MaskedNumber from "./MaskedNumber";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";

interface Props {
  domain: CardDomain;
  cards: LoyaltyMembership[];
  /** Offered while typing a cruise line — the lines the logbook uses. */
  coverageOptions?: string[];
  /** Reload the page's list after a write. */
  onChanged: () => void;
}

type Editing = { kind: "new"; prefill?: CardPrefill } | { kind: "edit"; id: string } | null;

/**
 * The frequent-flyer or cruise-line programmes, as one section of the loyalty
 * page. Kept a section of its own per domain on purpose: a tester found the
 * programmes easier to read split by travel type (Discord, 2026-08-08), and
 * the owner's one page keeps that split visible instead of flattening it.
 */
export default function LoyaltyCardSection({
  domain,
  cards,
  coverageOptions,
  onChanged,
}: Props): JSX.Element {
  const { t } = useTranslation(["loyalty", "common"]);
  const { confirm: askConfirm, confirmDialog } = useConfirmDialog();
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedSignal, setSavedSignal] = useState(0);

  const saved = (): void => {
    setEditing(null);
    setSavedSignal((n) => n + 1);
    onChanged();
  };

  const remove = async (card: LoyaltyMembership): Promise<void> => {
    const message = t("loyalty:confirmDelete", { name: card.programName });
    if (!(await askConfirm({ message, destructive: true }))) return;
    setError(null);
    try {
      await deleteLoyaltyMembership(card.id);
      onChanged();
    } catch (err: unknown) {
      logger.error("LoyaltyCardSection: delete failed", err);
      setError(saveErrorMessage(err, t, "loyalty:deleteError"));
    }
  };

  const coverageOf = (card: LoyaltyMembership): string[] =>
    domain === "flight" ? card.airlineCodes : card.cruiseLines;

  return (
    <SectionCard>
      <SectionTitle
        title={t(`loyalty:sections.${domain}.title`)}
        description={t(`loyalty:sections.${domain}.description`)}
      />
      {error !== null && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
          {error}
        </p>
      )}
      {cards.length === 0 && editing === null ? (
        <p className="t-caption">{t("loyalty:empty")}</p>
      ) : (
        <ul className="ts-setting-rows">
          {cards.map((card) =>
            editing?.kind === "edit" && editing.id === card.id ? (
              <li key={card.id}>
                <LoyaltyCardForm
                  domain={domain}
                  card={card}
                  coverageOptions={coverageOptions}
                  onSaved={saved}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={card.id} data-testid={`loyalty-card-${card.id}`} className="text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span style={{ fontWeight: 600, color: "var(--ts-text-bright)" }}>
                      {card.programName}
                    </span>
                    {card.tier && <span className="t-caption">{card.tier}</span>}
                    {card.membershipNumber && <MaskedNumber value={card.membershipNumber} />}
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setEditing({ kind: "edit", id: card.id })}
                      className="text-xs hover:underline"
                      style={{ color: "var(--ts-accent)", fontWeight: 600 }}
                    >
                      {t("common:buttons.edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(card)}
                      className="text-xs hover:underline"
                      style={{ color: "var(--ts-bad)", fontWeight: 600 }}
                    >
                      {t("common:buttons.delete")}
                    </button>
                  </div>
                </div>
                <p className="t-caption mt-1">
                  {coverageOf(card).length > 0
                    ? coverageOf(card).join(", ")
                    : t(`loyalty:coversNone.${domain}`)}
                </p>
                <ActivityLine domain={domain} activity={card.activity} />
                {card.notes && <p className="t-caption mt-1">{card.notes}</p>}
              </li>
            )
          )}
        </ul>
      )}

      {editing?.kind === "new" ? (
        <LoyaltyCardForm
          // A fresh form per suggestion: the prefill seeds state once.
          key={editing.prefill?.membershipNumber ?? "blank"}
          domain={domain}
          prefill={editing.prefill}
          coverageOptions={coverageOptions}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      ) : (
        editing === null && (
          <div>
            <button
              type="button"
              data-testid={`loyalty-add-${domain}`}
              onClick={() => setEditing({ kind: "new" })}
              className="btn-secondary"
            >
              {t("loyalty:add")}
            </button>
          </div>
        )
      )}

      {domain === "flight" && (
        <FrequentFlyerSuggestions
          reloadSignal={savedSignal}
          onAdopt={(prefill) => setEditing({ kind: "new", prefill })}
        />
      )}
      {confirmDialog}
    </SectionCard>
  );
}
