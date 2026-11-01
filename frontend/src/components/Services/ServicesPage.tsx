import { useEffect, useState, type JSX } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useToursVisible } from "../../hooks/useToursVisible";
import Button from "../ui/Button";
import { ErrorLine } from "../ui/settings";
import ServiceCard from "./ServiceCard";
import { SERVICE_CARDS, SERVICE_GROUPS, type ServiceGroup } from "./serviceCards";
import { ServicesProvider, useServices } from "./servicesContext";
import { isConfiguredStatus, useCardStatusOf } from "./useCardStatusOf";

/** Tours (and so their routing keys and the Strava import) sit behind the `roadtrips` beta key. */
const TOURS_ONLY: ReadonlySet<string> = new Set(["openrouteservice", "graphhopper", "strava"]);

function Cards({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const { account, admin } = useServices();
  const toursVisible = useToursVisible();
  const [params] = useSearchParams();
  const location = useLocation();
  const named = params.get("service") ?? decodeURIComponent(location.hash.replace(/^#/, ""));
  const linked = SERVICE_CARDS.find((c) => c.id === named);
  const statusOf = useCardStatusOf(isAdmin);
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
  const listed = SERVICE_CARDS.filter((c) => toursVisible || isAdmin || !TOURS_ONLY.has(c.id));

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
        {t("settingsRows:services.ui.intro")}
      </p>
      <div
        role="group"
        aria-label={t("settingsRows:services.ui.groupsLabel")}
        className="flex flex-wrap"
        style={{ gap: "var(--ts-space-sm)" }}
      >
        {(["all", ...SERVICE_GROUPS] as const).map((g) => (
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
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        {/* Filtered-out cards stay mounted, hidden: an unsaved key must not vanish with a click on a group. */}
        {listed.map((card) => (
          <ServiceCard
            key={card.id}
            card={card}
            isAdmin={isAdmin}
            linked={linked?.id === card.id}
            hidden={isHidden(card)}
            accountGated={!toursVisible && TOURS_ONLY.has(card.id)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Einstellungen › Dienste: 31 cards, one per catalogue entry, in the catalogue's
 * seven groups. The account's own part is on top of each card; for an admin the
 * server's part ("Alle Konten") follows it — separate data, separate endpoints,
 * separate failures.
 */
export default function ServicesPage({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  return (
    <ServicesProvider isAdmin={isAdmin}>
      <Cards isAdmin={isAdmin} />
    </ServicesProvider>
  );
}
