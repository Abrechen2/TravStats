import { useEffect, useState, type JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { CloudProviderKind } from "../../lib/api/admin";
import { externalServicesApi, type AdminService } from "../../lib/api/externalServices";
import { logger } from "../../lib/logger";
import Button from "../ui/Button";
import { ErrorLine } from "../ui/settings";
import { moveAmongEnabled, SERVICE_OF } from "./cloudOrder";

type Loaded =
  { kind: "loading" } | { kind: "failed" } | { kind: "ok"; byId: Map<string, AdminService> };

/**
 * The cloud chain, in the order it is asked after Ollama. Whether a provider is
 * on, its key and its consent live in Dienste; this list shows the ones switched
 * on there with their state and a link, and points the others to where they
 * are switched on. Only the ORDER is edited here (it is parser behaviour).
 */
export default function CloudOrderList({
  order,
  onChange,
}: {
  order: CloudProviderKind[];
  onChange: (next: CloudProviderKind[]) => void;
}): JSX.Element {
  const { t } = useTranslation(["settingsRows", "admin"]);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    externalServicesApi.adminOverview().then(
      (overview) => {
        if (!alive) return;
        const byId = new Map(overview.categories.flatMap((c) => c.services).map((s) => [s.id, s]));
        setLoaded({ kind: "ok", byId });
      },
      (error: unknown) => {
        logger.error("Loading the service status for the provider chain failed:", error);
        if (alive) setLoaded({ kind: "failed" });
      }
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (loaded.kind === "loading") {
    return <p className="t-caption">{t("settingsRows:server.cloud.loading")}</p>;
  }
  if (loaded.kind === "failed") {
    return (
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <ErrorLine>{t("settingsRows:server.cloud.loadFailed")}</ErrorLine>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {t("settingsRows:server.retry")}
        </Button>
      </div>
    );
  }
  const serviceOf = (kind: CloudProviderKind): AdminService | undefined =>
    loaded.byId.get(SERVICE_OF[kind]);
  const enabled = new Set(order.filter((kind) => serviceOf(kind)?.enabled === true));
  const onChain = order.filter((kind) => enabled.has(kind));
  const off = order.filter((kind) => !enabled.has(kind));
  const linkTo = (kind: CloudProviderKind): string => `/settings/services#${SERVICE_OF[kind]}`;

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      {onChain.length === 0 ? (
        <p className="t-caption" data-testid="llm-chain-empty">
          {t("settingsRows:server.cloud.noneEnabled")}
        </p>
      ) : (
        <ol className="flex flex-col" style={{ gap: "var(--ts-space-sm)", margin: 0, padding: 0 }}>
          {onChain.map((kind, index) => {
            const ready = serviceOf(kind)?.configured === true;
            return (
              <li
                key={kind}
                data-testid={`llm-slot-${kind}`}
                className="flex flex-wrap items-center"
                style={{
                  gap: "var(--ts-space-md)",
                  listStyle: "none",
                  padding: "var(--ts-space-sm) var(--ts-space-md)",
                  border: "1px solid var(--ts-border)",
                  borderRadius: "var(--ts-radius-card)",
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--ts-text-bright)" }}>
                  {t(`admin:parserSettings.provider.slots.${kind}.name`)}
                </span>
                <span
                  className="t-caption"
                  data-testid={`llm-slot-status-${kind}`}
                  style={{ color: ready ? "var(--ts-good)" : "var(--ts-warn)" }}
                >
                  {t(
                    ready ? "settingsRows:server.cloud.ready" : "settingsRows:server.cloud.missing"
                  )}
                </span>
                <Link to={linkTo(kind)} className="t-caption" style={{ color: "var(--ts-accent)" }}>
                  {t("settingsRows:server.cloud.open")}
                </Link>
                <span className="flex" style={{ marginLeft: "auto", gap: "var(--ts-space-xs)" }}>
                  <Button
                    variant="secondary"
                    aria-label={t("settingsRows:server.cloud.up", {
                      name: t(`admin:parserSettings.provider.slots.${kind}.name`),
                    })}
                    disabled={index === 0}
                    onClick={() => onChange(moveAmongEnabled(order, enabled, kind, -1))}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="secondary"
                    aria-label={t("settingsRows:server.cloud.down", {
                      name: t(`admin:parserSettings.provider.slots.${kind}.name`),
                    })}
                    disabled={index === onChain.length - 1}
                    onClick={() => onChange(moveAmongEnabled(order, enabled, kind, 1))}
                  >
                    ↓
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {off.length > 0 ? (
        <ul className="flex flex-col" style={{ gap: 4, margin: 0, padding: 0 }}>
          {off.map((kind) => (
            <li
              key={kind}
              className="t-caption"
              style={{ listStyle: "none" }}
              data-testid={`llm-slot-off-${kind}`}
            >
              {t(`admin:parserSettings.provider.slots.${kind}.name`)} ·{" "}
              <Link to={linkTo(kind)} style={{ color: "var(--ts-accent)" }}>
                {t("settingsRows:server.cloud.enable")}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
