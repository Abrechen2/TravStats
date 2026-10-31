import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { CloudProviderKind } from "../../lib/api/admin";
import { CLOUD_PROVIDER_KINDS } from "../../lib/api/admin";
import { externalServicesApi, type AdminService } from "../../lib/api/externalServices";
import { logger } from "../../lib/logger";
import { externalServiceLink } from "../ExternalServices/LegacyServiceSummary";
import type { ParserSettingsData } from "./ParserSettings";
import { AdminSubBlock } from "./AdminSubBlock";

interface LlmProviderSettingsProps {
  parserSettings: ParserSettingsData;
  onParserSettingsChange: (settings: ParserSettingsData) => void;
}

/** The catalogue service each cloud slot is switched on, keyed and consented in. */
const SERVICE_OF: Record<CloudProviderKind, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "gemini",
  custom: "customLlm",
};

/** The admin's saved priority, completed with any missing kind — mirrors the backend's `parseProviderOrder`. */
export function providerOrder(settings: ParserSettingsData): CloudProviderKind[] {
  const saved = settings.llmProviderOrder ?? [];
  const order: CloudProviderKind[] = [];
  for (const kind of saved) if (!order.includes(kind)) order.push(kind);
  for (const kind of CLOUD_PROVIDER_KINDS) if (!order.includes(kind)) order.push(kind);
  return order;
}

/**
 * Swaps `kind` with its nearest neighbour AMONG THE ENABLED slots, leaving
 * the disabled ones where they are: what the admin sees is the enabled list,
 * so "down" must mean "below the next one I can see".
 */
export function moveAmongEnabled(
  order: CloudProviderKind[],
  enabled: ReadonlySet<CloudProviderKind>,
  kind: CloudProviderKind,
  delta: 1 | -1
): CloudProviderKind[] {
  const from = order.indexOf(kind);
  let to = from + delta;
  while (to >= 0 && to < order.length && !enabled.has(order[to])) to += delta;
  if (from < 0 || to < 0 || to >= order.length) return order;
  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

type Loaded =
  { kind: "loading" } | { kind: "failed" } | { kind: "ok"; byId: Map<string, AdminService> };

/**
 * The provider chain: Ollama first when it has an endpoint, then the cloud
 * slots in the admin's order. The ORDER is parser behaviour and is edited
 * here; whether a provider is on, its key, model and consent live only in
 * Externe Dienste, so this list shows the providers switched on there with
 * their status and a link, and points the others to where they are enabled.
 */
export default function LlmProviderSettings({
  parserSettings,
  onParserSettingsChange,
}: LlmProviderSettingsProps): JSX.Element {
  const { t } = useTranslation(["admin", "externalServices"]);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

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
  }, []);

  const order = providerOrder(parserSettings);
  const serviceOf = (kind: CloudProviderKind): AdminService | undefined =>
    loaded.kind === "ok" ? loaded.byId.get(SERVICE_OF[kind]) : undefined;
  const enabled = new Set(order.filter((kind) => serviceOf(kind)?.enabled === true));
  const onChain = order.filter((kind) => enabled.has(kind));
  const off = order.filter((kind) => !enabled.has(kind));

  const reorder = (kind: CloudProviderKind, delta: 1 | -1): void => {
    onParserSettingsChange({
      ...parserSettings,
      llmProviderOrder: moveAmongEnabled(order, enabled, kind, delta),
    });
  };

  return (
    <AdminSubBlock title={t("admin:parserSettings.provider.title")} testId="llm-provider-settings">
      <p className="text-sm text-(--text-muted) mb-4">
        {t("admin:parserSettings.provider.description")}
      </p>
      <h4 className="text-sm font-semibold text-(--text-primary) mb-1">
        {t("admin:parserSettings.provider.chain.title")}
      </h4>
      <p className="text-xs text-(--text-muted) mb-4">
        {t("admin:parserSettings.provider.chain.hint")}
      </p>

      {loaded.kind === "loading" && (
        <p className="text-xs text-(--text-muted)">{t("admin:parserSettings.provider.loading")}</p>
      )}
      {loaded.kind === "failed" && (
        <p className="text-xs" style={{ color: "var(--danger)" }} role="alert">
          {t("admin:parserSettings.provider.loadFailed")}
        </p>
      )}
      {loaded.kind === "ok" && (
        <>
          {onChain.length === 0 && (
            <p className="text-xs text-(--text-muted)" data-testid="llm-chain-empty">
              {t("admin:parserSettings.provider.noneEnabled")}
            </p>
          )}
          <ol className="space-y-3">
            {onChain.map((kind, index) => (
              <ChainSlot
                key={kind}
                kind={kind}
                service={serviceOf(kind)}
                first={index === 0}
                last={index === onChain.length - 1}
                onMove={(delta): void => reorder(kind, delta)}
              />
            ))}
          </ol>
          {off.length > 0 && (
            <ul className="mt-4 space-y-2">
              {off.map((kind) => (
                <li
                  key={kind}
                  className="text-xs text-(--text-muted)"
                  data-testid={`llm-slot-off-${kind}`}
                >
                  {t(`admin:parserSettings.provider.slots.${kind}.name`)} ·{" "}
                  <Link
                    to={externalServiceLink("admin", SERVICE_OF[kind])}
                    className="underline"
                    style={{ color: "var(--ts-accent)" }}
                  >
                    {t("admin:parserSettings.provider.enableInServices")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AdminSubBlock>
  );
}

function ChainSlot({
  kind,
  service,
  first,
  last,
  onMove,
}: {
  kind: CloudProviderKind;
  service: AdminService | undefined;
  first: boolean;
  last: boolean;
  onMove: (delta: 1 | -1) => void;
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const ready = service?.configured === true;
  return (
    <li
      className="rounded-lg border border-(--color-border) p-3 flex flex-wrap items-center gap-3"
      data-testid={`llm-slot-${kind}`}
    >
      <span className="text-sm font-semibold text-(--text-primary)">
        {t(`admin:parserSettings.provider.slots.${kind}.name`)}
      </span>
      <span
        className="text-xs font-medium"
        style={{ color: ready ? "var(--success)" : "var(--warning)" }}
        data-testid={`llm-slot-status-${kind}`}
      >
        {t(
          ready
            ? "admin:parserSettings.provider.status.active"
            : "admin:parserSettings.provider.status.missing"
        )}
      </span>
      <Link
        to={externalServiceLink("admin", SERVICE_OF[kind])}
        className="text-xs underline"
        style={{ color: "var(--ts-accent)" }}
      >
        {t("admin:parserSettings.provider.openInServices")}
      </Link>
      <span className="ml-auto flex gap-1">
        <button
          type="button"
          onClick={(): void => onMove(-1)}
          disabled={first}
          aria-label={t("admin:parserSettings.provider.chain.moveUp")}
          className="px-2 py-1 text-xs border border-border rounded-sm hover:bg-(--bg-base) disabled:opacity-30 transition"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={(): void => onMove(1)}
          disabled={last}
          aria-label={t("admin:parserSettings.provider.chain.moveDown")}
          className="px-2 py-1 text-xs border border-border rounded-sm hover:bg-(--bg-base) disabled:opacity-30 transition"
        >
          ↓
        </button>
      </span>
    </li>
  );
}
