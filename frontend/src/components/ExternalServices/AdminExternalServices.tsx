import { useMemo, useState, type JSX } from "react";
import Button from "../ui/Button";
import Chip from "../ui/Chip";
import { Card } from "../ui/Card";
import { Input } from "../ui/Field";
import StatTile from "../ui/StatTile";
import { useTranslation } from "../../hooks/useTranslation";
import { useEffectiveSettingsLevel } from "../../store/settingsLevelStore";
import type { AdminService } from "../../lib/api/externalServices";
import AccountConnectionsPolicy from "./AccountConnectionsPolicy";
import AdminConsentDialog from "./AdminConsentDialog";
import AdminServiceRow from "./AdminServiceRow";
import ServiceInfoDialog from "./ServiceInfoDialog";
import { useAdminServices } from "./useAdminServices";
import { adminStatus, countStatuses, matchesFilter, type StatusFilter } from "./serviceStatus";
import { serviceCopy, serviceName } from "./serviceText";

const FILTERS: readonly StatusFilter[] = ["all", "recommended", "active", "attention", "off"];

/**
 * Administration › Externe Dienste (forgejo#392): every service TravStats does
 * not run itself, in one list, each with the same row.
 *
 * Standard and Expert are the settings level the whole page frame switches
 * (`settingsLevelStore`), not a second switch of this page: Standard shows every
 * service and hides only addresses, endpoints and the source order.
 */
export default function AdminExternalServices(): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  const expert = useEffectiveSettingsLevel() === "expert";
  const services = useAdminServices();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [consentId, setConsentId] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);

  const { data } = services;
  const all = useMemo<AdminService[]>(
    () => (data ? data.categories.flatMap((category) => category.services) : []),
    [data]
  );
  const counts = useMemo(() => countStatuses(all.map(adminStatus)), [all]);
  const recommended = all.filter((s) => s.recommended !== null);
  const recommendedActive = recommended.filter((s) => adminStatus(s) === "active").length;

  const q = query.trim().toLowerCase();
  const visibleCategories = useMemo(() => {
    if (!data) return [];
    return data.categories
      .map((category) => ({
        ...category,
        services: category.services.filter((service) => {
          if (!matchesFilter(filter, adminStatus(service), service.recommended)) return false;
          if (!q) return true;
          const haystack = `${serviceName(t, service.id)} ${serviceCopy(t, service.id, "purpose")}`;
          return haystack.toLowerCase().includes(q);
        }),
      }))
      .filter((category) => category.services.length > 0);
    // `t` changes with the language, which changes the searchable names.
  }, [data, filter, q, t]);

  if (services.loadError && !data) {
    return (
      <Card>
        <p role="alert" style={{ color: "var(--ts-bad)" }}>
          {services.loadError}
        </p>
        <Button variant="secondary" onClick={() => void services.reload()}>
          {t("externalServices:actions.retry")}
        </Button>
      </Card>
    );
  }
  if (!data) return <p className="t-caption">{t("externalServices:loading")}</p>;

  const infoService = all.find((s) => s.id === infoId) ?? null;

  const closeConsent = (): void => {
    setConsentId(null);
    setConsentError(null);
  };
  const confirmConsent = async (): Promise<void> => {
    if (!consentId) return;
    const failure = await services.setEnabled(consentId, true, true);
    if (failure) {
      setConsentError(failure);
      return;
    }
    setOpenId(consentId);
    closeConsent();
  };

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <p className="t-body" style={{ maxWidth: 720 }}>
        {t("externalServices:intro")}
      </p>
      {services.loadError ? (
        <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
          {services.loadError}
        </p>
      ) : null}

      <div
        className="grid"
        style={{
          gap: "var(--ts-space-md)",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        }}
      >
        <StatTile value={counts.active} label={t("externalServices:summary.active")} />
        <StatTile value={counts.attention} label={t("externalServices:summary.attention")} />
        <StatTile value={counts.off} label={t("externalServices:summary.off")} />
      </div>

      {recommended.length > 0 ? (
        <Card>
          <div
            className="flex flex-wrap items-center justify-between"
            style={{ gap: "var(--ts-space-lg)" }}
          >
            <div className="flex flex-col" style={{ gap: 2, maxWidth: 680 }}>
              <strong>{t("externalServices:banner.title")}</strong>
              <span className="t-caption">
                {t("externalServices:banner.summary", {
                  active: recommendedActive,
                  total: recommended.length,
                })}
              </span>
            </div>
            <Button variant="secondary" onClick={() => setFilter("recommended")}>
              {t("externalServices:banner.show")}
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <Input
          type="search"
          aria-label={t("externalServices:search.label")}
          placeholder={t("externalServices:search.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div
          role="group"
          aria-label={t("externalServices:filter.label")}
          className="flex flex-wrap"
          style={{ gap: "var(--ts-space-sm)" }}
        >
          {FILTERS.map((key) => (
            <Chip key={key} active={filter === key} onClick={() => setFilter(key)}>
              {t(`externalServices:filter.${key}`)}
            </Chip>
          ))}
        </div>
      </div>

      {visibleCategories.length === 0 ? (
        <Card>
          <p className="t-body">{t("externalServices:noResults")}</p>
        </Card>
      ) : null}

      {visibleCategories.map((category) => {
        const active = category.services.filter((s) => adminStatus(s) === "active").length;
        return (
          <section
            key={category.id}
            className="flex flex-col"
            style={{ gap: "var(--ts-space-md)" }}
            data-service-category={category.id}
          >
            <div
              className="flex flex-wrap items-baseline justify-between"
              style={{ gap: "var(--ts-space-md)" }}
            >
              <h2 className="t-card-title">
                {t(`externalServices:categories.${category.id}`, { defaultValue: category.id })}
              </h2>
              <span className="t-caption">
                {t("externalServices:categorySummary", { count: category.services.length, active })}
              </span>
            </div>
            <Card flush>
              {category.services.map((service) => (
                <AdminServiceRow
                  key={service.id}
                  service={service}
                  expert={expert}
                  open={openId === service.id}
                  busy={services.busyId === service.id}
                  feedback={services.feedback[service.id] ?? null}
                  actions={{
                    onToggleOpen: () => {
                      // Closing a row that embeds an older control: what it saved
                      // is derived on the server, so the status is read again.
                      if (openId === service.id) void services.reload();
                      setOpenId(openId === service.id ? null : service.id);
                    },
                    onInfo: () => setInfoId(service.id),
                    onTest: () => void services.test(service.id),
                    onSave: (changes) => void services.save(service.id, changes),
                    onFlip: () => void services.setEnabled(service.id, !service.enabled),
                    onAskConsent: () => {
                      if (service.enabled) void services.setEnabled(service.id, false);
                      else setConsentId(service.id);
                    },
                    onAllowAccountKeys: (allowed) =>
                      void services.setAllowAccountKeys(service.id, allowed),
                  }}
                />
              ))}
            </Card>
          </section>
        );
      })}

      <AccountConnectionsPolicy
        policies={data.accountConnections}
        busyId={services.busyId}
        feedback={services.feedback}
        onChange={(id, allowed) => void services.setConnection(id, allowed)}
      />

      {infoService ? (
        <ServiceInfoDialog
          serviceId={infoService.id}
          level={infoService.level}
          recommended={infoService.recommended}
          scope="admin"
          onClose={() => setInfoId(null)}
        />
      ) : null}
      {consentId ? (
        <AdminConsentDialog
          serviceId={consentId}
          busy={services.busyId === consentId}
          error={consentError}
          onConfirm={() => void confirmConsent()}
          onClose={closeConsent}
        />
      ) : null}
    </div>
  );
}
