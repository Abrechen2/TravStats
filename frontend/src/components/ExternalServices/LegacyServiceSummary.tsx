import { useEffect, useState, type JSX, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Pill from "../ui/Pill";
import { token } from "../ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import {
  externalServicesApi,
  type AccountService,
  type AdminService,
} from "../../lib/api/externalServices";
import { accountStatus, adminStatus } from "./serviceStatus";
import { serviceName } from "./serviceText";

type Scope = "admin" | "account";

type Summary = "active" | "attention" | "off";

/** Where the full editor lives; `?service=` opens that row. */
export function externalServiceLink(scope: Scope, serviceId: string): string {
  const id = encodeURIComponent(serviceId);
  return scope === "admin"
    ? `/admin/externalServices?service=${id}`
    : `/settings/services?section=externalServices&service=${id}`;
}

function adminSummary(service: AdminService): Summary {
  const status = adminStatus(service);
  if (status === "active") return "active";
  return status === "off" ? "off" : "attention";
}

function accountSummary(service: AccountService): Summary {
  const status = accountStatus(service, "connection");
  if (status === "connected" || status === "viaInstance") return "active";
  return status === "off" ? "off" : "attention";
}

const COLOR: Record<Summary, string> = {
  active: "status-flown",
  attention: "status-review",
  off: "status-historical",
};

/**
 * What an old service page shows now that the full editor lives under Externe
 * Dienste (settings redesign, package 5): the service's status in one pill and
 * the way there. Old routes and bookmarks still land here, so nothing that
 * linked to the old page ends on a blank.
 */
export default function LegacyServiceSummary({
  serviceId,
  scope = "admin",
  children,
}: {
  serviceId: string;
  scope?: Scope;
  /** What stays on this page (the parser's import behaviour). */
  children?: ReactNode;
}): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  const [summary, setSummary] = useState<Summary | "unknown" | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        if (scope === "admin") {
          const overview = await externalServicesApi.adminOverview();
          const found = overview.categories
            .flatMap((category) => category.services)
            .find((s) => s.id === serviceId);
          if (alive) setSummary(found ? adminSummary(found) : "unknown");
        } else {
          const overview = await externalServicesApi.accountOverview();
          const found = [...overview.connections, ...overview.ownKeys].find(
            (s) => s.id === serviceId
          );
          if (alive) setSummary(found ? accountSummary(found) : "unknown");
        }
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [serviceId, scope]);

  const name = serviceName(t, serviceId);
  return (
    <div
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
      data-testid="legacy-service-summary"
      data-service={serviceId}
    >
      <h3 className="t-card-title">{t("externalServices:legacy.title")}</h3>
      <p className="t-body">{t("externalServices:legacy.body", { name })}</p>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <span className="t-caption">{t("externalServices:legacy.statusLabel")}</span>
        {failed ? (
          <span role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
            {t("externalServices:legacy.loadFailed")}
          </span>
        ) : summary && summary !== "unknown" ? (
          <Pill color={token(COLOR[summary])}>
            {t(`externalServices:legacy.status.${summary}`)}
          </Pill>
        ) : summary === "unknown" ? (
          <span className="t-caption">{t("externalServices:legacy.status.unknown")}</span>
        ) : null}
        <Link
          to={externalServiceLink(scope, serviceId)}
          className="underline"
          style={{ color: "var(--ts-accent)" }}
        >
          {t("externalServices:actions.openInServices")}
        </Link>
      </div>
      {children}
    </div>
  );
}

/** A sentence and the link to the service's row: for a form that kept its other parts. */
export function ServiceMovedNote({
  serviceId,
  text,
}: {
  serviceId: string;
  text: string;
}): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  return (
    <p className="t-caption" data-testid="service-moved-note" data-service={serviceId}>
      {text}{" "}
      <Link
        to={externalServiceLink("admin", serviceId)}
        className="underline"
        style={{ color: "var(--ts-accent)" }}
      >
        {t("externalServices:actions.openInServices")}
      </Link>
    </p>
  );
}
