import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import ActivityLine from "../Loyalty/ActivityLine";
import LoyaltyCardSection from "../Loyalty/LoyaltyCardSection";
import MembershipsSection from "./MembershipsSection";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useTranslation } from "../../hooks/useTranslation";
import { cruiseApi } from "../../lib/api/cruise";
import { listLoyaltyMemberships } from "../../lib/api/loyalty";
import { logger } from "../../lib/logger";
import { LOYALTY_DOMAINS, type LoyaltyDomain } from "../../shared/domains";
import type { LoyaltyMembership } from "../../types/loyalty";

/** The anchor each domain's block answers to inside the settings section. */
export const loyaltySectionId = (domain: LoyaltyDomain): string => `loyalty-${domain}`;

/**
 * Every loyalty programme, managed in ONE place: Einstellungen → Bonusprogramme
 * (owner, 2026-09-26, on the tester's word: "in den Einstellungen zentral die
 * Möglichkeit … alle Bonusprogramme zu verwalten").
 *
 * It was a page of its own (`/loyalty`) for one beta; that URL now lands here.
 * Still split by domain inside the section: the same tester found separate
 * lists clearer (Discord, 2026-08-08), so each travel type keeps its own
 * block, and only domains the user has switched on get one.
 *
 * The hotel block IS the 2.6 hotel editor (`MembershipsSection`: chains,
 * single hotels, the stay editor's cards) — one editor for hotel cards, not a
 * second one beside it. The airline and cruise-line blocks are
 * `LoyaltyCardSection`.
 */
export default function LoyaltySection(): JSX.Element {
  const { t } = useTranslation(["loyalty"]);
  const { isEnabled } = useEnabledDomains();
  const [cards, setCards] = useState<LoyaltyMembership[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [cruiseLines, setCruiseLines] = useState<string[]>([]);

  const domains = useMemo(() => LOYALTY_DOMAINS.filter((d) => isEnabled(d)), [isEnabled]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setCards(await listLoyaltyMemberships());
      setLoadError(false);
    } catch (err: unknown) {
      logger.error("LoyaltySection: load failed", err);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The lines the logbook already uses, offered while typing one — a card
  // whose line is spelled differently from the cruises covers none of them.
  const cruiseOn = domains.includes("cruise");
  useEffect(() => {
    if (!cruiseOn) return;
    cruiseApi
      .facets()
      .then((facets) => setCruiseLines(facets.lines.map((line) => line.value)))
      .catch((err: unknown) => logger.warn("LoyaltySection: cruise lines unavailable", err));
  }, [cruiseOn]);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const ofDomain = (domain: LoyaltyDomain): LoyaltyMembership[] =>
    cards.filter((c) => c.domain === domain);

  const block = (domain: LoyaltyDomain): JSX.Element => {
    if (domain === "lodging") {
      return (
        <MembershipsSection
          title={t("loyalty:sections.lodging.title")}
          description={t("loyalty:sections.lodging.description")}
          onChanged={() => void reload()}
          renderExtra={(m) => {
            const card = byId.get(m.id);
            return card ? <ActivityLine domain="lodging" activity={card.activity} /> : null;
          }}
        />
      );
    }
    return (
      <LoyaltyCardSection
        domain={domain}
        cards={ofDomain(domain)}
        coverageOptions={domain === "cruise" ? cruiseLines : undefined}
        onChanged={() => void reload()}
      />
    );
  };

  if (domains.length === 0) {
    return <p className="t-caption">{t("loyalty:noDomains")}</p>;
  }

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      {loadError && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
          {t("loyalty:loadError")}
        </p>
      )}
      {domains.map((domain) => (
        <div
          key={domain}
          id={loyaltySectionId(domain)}
          data-testid={loyaltySectionId(domain)}
          style={{ scrollMarginTop: "5rem" }}
        >
          {block(domain)}
        </div>
      ))}
    </div>
  );
}
