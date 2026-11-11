import { useEffect, useState, type JSX } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useToursVisible } from "../../hooks/useToursVisible";
import Button from "../ui/Button";
import { ErrorLine } from "../ui/settings";
import ServiceCard from "./ServiceCard";
import { useExpertRows } from "../Settings/frame/useExpertRows";
import {
  ACCOUNT_CARDS,
  FOLDED_INTO_INTERNET,
  SERVER_CARDS,
  SERVICE_CARDS,
  SERVICE_GROUPS,
  type ServiceCardDef,
  type ServiceGroup,
} from "./serviceCards";
import { ServicesProvider, useServices } from "./servicesContext";
import { isConfiguredStatus, useCardStatusOf } from "./useCardStatusOf";

/** Tours (and so their routing keys and the Strava import) sit behind the `roadtrips` beta key. */
const TOURS_ONLY: ReadonlySet<string> = new Set(["openrouteservice", "graphhopper", "strava"]);

/** Which half of the catalogue a page draws: the account's, the server's, or (old) both. */
export type ServicesSide = "account" | "server" | "both";

function cardsOf(side: ServicesSide): readonly ServiceCardDef[] {
  return side === "account" ? ACCOUNT_CARDS : side === "server" ? SERVER_CARDS : SERVICE_CARDS;
}

function Cards({ isAdmin, side }: { isAdmin: boolean; side: ServicesSide }): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const { account, admin } = useServices();
  const toursVisible = useToursVisible();
  const [params] = useSearchParams();
  const location = useLocation();
  const named = params.get("service") ?? decodeURIComponent(location.hash.replace(/^#/, ""));
  const linked = SERVICE_CARDS.find((c) => c.id === named);
  const statusOf = useCardStatusOf(isAdmin);
  // The cards behind the master switch are an expert matter on the server's page.
  const expert = useExpertRows(side === "server" ? FOLDED_INTO_INTERNET.size : 0);
  const [onlyConfigured, setOnlyConfigured] = useState(false);
  const [group, setGroup] = useState<ServiceGroup | "all">(linked?.group ?? "all");
  useEffect(() => {
    if (linked) setGroup(linked.group);
  }, [linked]);

  if (account.loadError && !account.data) {
    return (
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <ErrorLine>{t("settingsRows:services.ui.loadFailed")}</ErrorLine>
        <div>
          <Button variant="secondary" onClick={() => void account.reload()}>
            {t("settingsRows:services.ui.retry")}
          </Button>
        </div>
      </div>
    );
  }
  if (!account.data) {
    return <p className="t-caption">{t("settingsRows:services.ui.loading")}</p>;
  }

  // Tours-only cards stay for an admin: the instance's routing and Strava keys are theirs.
  const listed = cardsOf(side).filter(
    (c) =>
      (toursVisible || isAdmin || !TOURS_ONLY.has(c.id)) &&
      (side !== "server" || expert || linked?.id === c.id || !FOLDED_INTO_INTERNET.has(c.id))
  );

  const isHidden = (card: (typeof SERVICE_CARDS)[number]): boolean =>
    (group !== "all" && card.group !== group) ||
    (onlyConfigured && linked?.id !== card.id && !isConfiguredStatus(statusOf(card)));
  const anyShown = listed.some((c) => !isHidden(c));

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
      {isAdmin && admin?.loadError && !admin.data ? (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
          <ErrorLine>{t("settingsRows:services.ui.serverLoadFailed")}</ErrorLine>
          <Button variant="secondary" onClick={() => void admin.reload()}>
            {t("settingsRows:services.ui.retry")}
          </Button>
        </div>
      ) : null}
      <p className="t-body" style={{ maxWidth: 720, margin: 0 }}>
        {t(
          side === "account"
            ? "settingsRows:services.ui.introAccount"
            : side === "server"
              ? "settingsRows:services.ui.introServer"
              : "settingsRows:services.ui.intro"
        )}
      </p>
      <div
        role="group"
        aria-label={t("settingsRows:services.ui.groupsLabel")}
        className="flex flex-wrap"
        style={{ gap: "var(--ts-space-sm)" }}
      >
        {(["all", ...groupsOf(listed)] as const).map((g) => (
          <Button
            key={g}
            variant={group === g ? "primary" : "secondary"}
            aria-pressed={group === g}
            onClick={() => setGroup(g)}
          >
            {t(`settingsRows:services.groups.${g === "all" ? "alle" : g}`)}
          </Button>
        ))}
      </div>
      <label className="flex items-center" style={{ gap: "var(--ts-space-sm)" }}>
        <input
          type="checkbox"
          checked={onlyConfigured}
          onChange={(event) => setOnlyConfigured(event.target.checked)}
        />
        <span className="t-body">{t("settingsRows:services.ui.onlyConfigured")}</span>
      </label>
      {!anyShown && (
        <p role="status" data-testid="services-empty" className="t-caption">
          {t("settingsRows:services.ui.noneConfigured")}
        </p>
      )}
      <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
        {/* Filtered-out cards stay mounted, hidden: an unsaved key must not vanish with a click on a group. */}
        {groupsOf(listed).map((g) => (
          <section
            key={g}
            aria-label={t(`settingsRows:services.groups.${g}`)}
            hidden={listed.filter((c) => c.group === g).every(isHidden)}
            className="flex flex-col"
            style={{ gap: "var(--ts-space-md)" }}
          >
            <h3 className="t-card-title">{t(`settingsRows:services.groups.${g}`)}</h3>
            <div className="svc-grid">
              {listed
                .filter((c) => c.group === g)
                .map((card) => (
                  <div key={card.id} className="svc-tile" hidden={isHidden(card)}>
                    <ServiceCard
                      card={card}
                      isAdmin={isAdmin}
                      side={side}
                      linked={linked?.id === card.id}
                      hidden={isHidden(card)}
                      accountGated={!toursVisible && TOURS_ONLY.has(card.id)}
                    />
                  </div>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * Einstellungen › Verbundene Dienste (account) and › Dienste (server): the
 * catalogue as a grid of cards in groups. The account's page holds the cards an
 * account has something to do with (its own key, connection or consent); the
 * server's page holds the grid of the prototype, and — at the expert level — the
 * cards behind "Server darf externe Dienste abfragen". Separate data, separate
 * endpoints, separate failures.
 */
export default function ServicesPage({
  isAdmin,
  side = "both",
}: {
  isAdmin: boolean;
  side?: ServicesSide;
}): JSX.Element {
  return (
    <ServicesProvider isAdmin={isAdmin}>
      <Cards isAdmin={isAdmin} side={side} />
    </ServicesProvider>
  );
}

/** The groups that have a card on this page, in the catalogue's order. */
function groupsOf(cards: readonly ServiceCardDef[]): ServiceGroup[] {
  return SERVICE_GROUPS.filter((g) => cards.some((c) => c.group === g));
}
