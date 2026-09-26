import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useLocation } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import PageHeader from "../components/ui/PageHeader";
import ActivityLine from "../components/Loyalty/ActivityLine";
import LoyaltyCardSection from "../components/Loyalty/LoyaltyCardSection";
import MembershipsSection from "../components/Settings/MembershipsSection";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { useTranslation } from "../hooks/useTranslation";
import { cruiseApi } from "../lib/api/cruise";
import { listLoyaltyMemberships } from "../lib/api/loyalty";
import { logger } from "../lib/logger";
import { LOYALTY_DOMAINS, type LoyaltyDomain } from "../shared/domains";
import type { LoyaltyMembership } from "../types/loyalty";

/** The anchor each section answers to — `/loyalty#flight` scrolls to it. */
export const loyaltySectionId = (domain: LoyaltyDomain): string => `loyalty-${domain}`;

/**
 * Every loyalty programme in one place (owner, 2026-09-25): frequent-flyer
 * cards, cruise-line clubs and hotel programmes, each with what the logbook
 * says it was used for.
 *
 * One page, still split by domain. A tester asked for a central place and in
 * the same breath found separate lists clearer (Discord, 2026-08-08), so the
 * sections stay visibly apart, and only domains the user has switched on get
 * one. The hotel section is the same editor Settings used to hold — chains,
 * single hotels, the stay editor's cards — so there is one way to edit a
 * hotel card, not two.
 */
export default function LoyaltyPage(): JSX.Element {
  const { t } = useTranslation(["loyalty"]);
  const { isEnabled } = useEnabledDomains();
  const location = useLocation();
  const [cards, setCards] = useState<LoyaltyMembership[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [cruiseLines, setCruiseLines] = useState<string[]>([]);

  const domains = useMemo(() => LOYALTY_DOMAINS.filter((d) => isEnabled(d)), [isEnabled]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setCards(await listLoyaltyMemberships());
      setLoadError(false);
    } catch (err: unknown) {
      logger.error("LoyaltyPage: load failed", err);
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
      .catch((err: unknown) => logger.warn("LoyaltyPage: cruise lines unavailable", err));
  }, [cruiseOn]);

  // A settings link lands on `#flight` / `#cruise` / `#lodging`.
  useEffect(() => {
    const domain = location.hash.replace(/^#/, "");
    if (!(LOYALTY_DOMAINS as readonly string[]).includes(domain)) return;
    document
      .getElementById(loyaltySectionId(domain as LoyaltyDomain))
      ?.scrollIntoView({ block: "start" });
  }, [location.hash, domains]);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const ofDomain = (domain: LoyaltyDomain): LoyaltyMembership[] =>
    cards.filter((c) => c.domain === domain);

  const section = (domain: LoyaltyDomain): JSX.Element => {
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

  return (
    <AppShell width="reading">
      <PageHeader
        title={t("loyalty:title")}
        meta={t("loyalty:meta")}
        actions={
          domains.length > 1 ? (
            <nav aria-label={t("loyalty:jumpTo")} className="flex flex-wrap gap-2">
              {domains.map((domain) => (
                <a
                  key={domain}
                  href={`#${domain}`}
                  className="t-caption hover:underline"
                  style={{ color: "var(--ts-accent)", fontWeight: 600 }}
                >
                  {t(`loyalty:sections.${domain}.title`)}
                </a>
              ))}
            </nav>
          ) : undefined
        }
      />
      {loadError && (
        <p className="t-caption mb-4" role="alert" style={{ color: "var(--ts-bad)" }}>
          {t("loyalty:loadError")}
        </p>
      )}
      {domains.length === 0 ? (
        <p className="t-caption">{t("loyalty:noDomains")}</p>
      ) : (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xxl)" }}>
          {domains.map((domain) => (
            <section
              key={domain}
              id={loyaltySectionId(domain)}
              data-testid={loyaltySectionId(domain)}
              style={{ scrollMarginTop: "5rem" }}
            >
              {section(domain)}
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
