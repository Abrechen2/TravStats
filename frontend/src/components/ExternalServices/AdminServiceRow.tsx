import type { JSX, ReactNode } from "react";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import { Icon } from "../ui/Icon";
import { Switch } from "../ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import type { AdminService } from "../../lib/api/externalServices";
import { AdminStatusPill } from "./ServiceStatusPill";
import { Monogram, ServiceTitle } from "./ServiceIdentity";
import { ServiceFields, useFieldDrafts } from "./ServiceFields";
import { SpecialisedControl, replacesGenericFields } from "./SpecialisedControl";
import { adminStatus, budgetPercent, hasHiddenExpertFields, visibleFields } from "./serviceStatus";
import { adminTestLine, serviceCopy, serviceName, sourceLine } from "./serviceText";

export interface RowFeedback {
  kind: "ok" | "error" | "info";
  text: string;
}

export interface AdminRowActions {
  onToggleOpen: () => void;
  onInfo: () => void;
  onTest: () => void;
  /** Saves the changed fields, then tests. */
  onSave: (changes: Record<string, unknown>) => void;
  /** Plain on/off; a cloud AI provider goes through the consent dialog instead. */
  onFlip: () => void;
  onAskConsent: () => void;
  onAllowAccountKeys: (allowed: boolean) => void;
}

interface AdminServiceRowProps {
  service: AdminService;
  expert: boolean;
  open: boolean;
  busy: boolean;
  feedback: RowFeedback | null;
  actions: AdminRowActions;
}

/** A cloud AI provider: its data leaves the server, so it has the consent flow. */
export function isCloudAi(service: AdminService): boolean {
  return service.consent !== undefined;
}

function feedbackColor(kind: RowFeedback["kind"]): string {
  return kind === "error" ? "var(--ts-bad)" : kind === "ok" ? "var(--ts-good)" : "var(--ts-muted)";
}

function Budget({ service }: { service: AdminService }): JSX.Element | null {
  const { t } = useTranslation(["externalServices"]);
  const percent = budgetPercent(service.quota);
  const quota = service.quota;
  if (percent === null || !quota) return null;
  return (
    <div className="flex items-center" style={{ gap: "var(--ts-space-md)", maxWidth: 520 }}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--ts-surface2)" }}
      >
        <div
          style={{
            width: `${Math.max(percent, 1)}%`,
            height: "100%",
            borderRadius: 999,
            background: "var(--ts-accent)",
          }}
        />
      </div>
      <span className="t-caption">
        {t("externalServices:budget", {
          used: quota.used ?? 0,
          limit: quota.limit ?? 0,
          unit: quota.unit ?? "",
        })}
      </span>
    </div>
  );
}

export default function AdminServiceRow({
  service,
  expert,
  open,
  busy,
  feedback,
  actions,
}: AdminServiceRowProps): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  const name = serviceName(t, service.id);
  const status = adminStatus(service);
  const cloud = isCloudAi(service);
  const levelLabel = t(`externalServices:level.${service.level}`);
  const shown = visibleFields(service.fields, expert);
  const generic = !replacesGenericFields(service.id);

  return (
    <div data-service-row={service.id} style={{ borderTop: "1px solid var(--ts-border)" }}>
      <div
        className="flex flex-wrap items-center"
        style={{ gap: "var(--ts-space-lg)", padding: "var(--ts-space-lg)" }}
      >
        <Monogram name={name} />
        <div className="flex min-w-0 flex-col" style={{ flex: "1 1 280px", gap: 2 }}>
          <ServiceTitle
            name={name}
            levelLabel={levelLabel}
            recommended={service.recommended}
            extra={
              cloud ? (
                <span className="t-caption" style={{ color: "var(--ts-warn)" }}>
                  {t("externalServices:dataLeaves")}
                </span>
              ) : null
            }
          />
          <span className="t-caption">{serviceCopy(t, service.id, "purpose")}</span>
          <span
            className="t-caption"
            style={{ color: feedback ? feedbackColor(feedback.kind) : undefined }}
            role={feedback?.kind === "error" ? "alert" : "status"}
          >
            {feedback ? feedback.text : adminTestLine(t, service)}
          </span>
          <Budget service={service} />
        </div>
        <AdminStatusPill status={status} />
        <div className="flex items-center" style={{ gap: "var(--ts-space-sm)" }}>
          <Button variant="secondary" disabled={busy} onClick={actions.onTest}>
            {t("externalServices:actions.test")}
          </Button>
          <IconButton label={t("externalServices:actions.info", { name })} onClick={actions.onInfo}>
            <Icon name="info" />
          </IconButton>
          <IconButton
            label={t(
              open ? "externalServices:actions.collapse" : "externalServices:actions.expand"
            )}
            aria-expanded={open}
            onClick={actions.onToggleOpen}
          >
            <Icon name={open ? "chevron-up" : "chevron-down"} />
          </IconButton>
        </div>
      </div>
      {open ? (
        <ExpandedBody
          // A new server answer (after a save) restarts the drafts from it.
          key={JSON.stringify(service.fields)}
          service={service}
          expert={expert}
          busy={busy}
          cloud={cloud}
          generic={generic}
          shown={shown}
          actions={actions}
        />
      ) : null}
    </div>
  );
}

function ExpandedBody({
  service,
  expert,
  busy,
  cloud,
  generic,
  shown,
  actions,
}: {
  service: AdminService;
  expert: boolean;
  busy: boolean;
  cloud: boolean;
  generic: boolean;
  shown: AdminService["fields"];
  actions: AdminRowActions;
}): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  const { drafts, setDraft, changes } = useFieldDrafts(service.fields);
  const off = !service.enabled;
  const dirty = Object.keys(changes).some((key) => shown.some((f) => f.key === key));
  let extras: ReactNode = null;
  if (expert) {
    extras = (
      <div
        className="grid"
        style={{
          gap: "var(--ts-space-lg)",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        }}
      >
        <ExpertFact title={t("externalServices:expert.order")}>
          {serviceCopy(t, service.id, "order", "–")}
        </ExpertFact>
        <ExpertFact title={t("externalServices:expert.quota")}>
          {serviceCopy(t, service.id, "quotaLine", "–")}
        </ExpertFact>
        <ExpertFact title={t("externalServices:expert.env")}>
          {t("externalServices:expert.envText")}
        </ExpertFact>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col"
      style={{
        gap: "var(--ts-space-lg)",
        padding: "0 var(--ts-space-lg) var(--ts-space-lg)",
      }}
    >
      {generic ? (
        <ServiceFields
          serviceId={service.id}
          fields={shown}
          drafts={drafts}
          disabled={busy}
          onChange={setDraft}
        />
      ) : (
        <SpecialisedControl serviceId={service.id} />
      )}
      {generic && hasHiddenExpertFields(service.fields, expert) ? (
        <p className="t-caption">{t("externalServices:expertHidden")}</p>
      ) : null}
      {service.allowAccountKeys !== null ? (
        <Switch
          label={t("externalServices:allowAccountKeys")}
          sub={t(
            service.allowAccountKeys
              ? "externalServices:allowAccountKeysOn"
              : "externalServices:allowAccountKeysOff"
          )}
          checked={service.allowAccountKeys}
          disabled={busy}
          onChange={actions.onAllowAccountKeys}
        />
      ) : null}
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        {service.alwaysOn ? (
          <span className="t-caption" data-always-on>
            {t("externalServices:alwaysOn.label")} {serviceCopy(t, service.id, "alwaysOnWhy")}
          </span>
        ) : cloud ? (
          <Button variant="secondary" disabled={busy} onClick={actions.onAskConsent}>
            {t(
              service.enabled
                ? "externalServices:consent.withdraw"
                : "externalServices:consent.allow"
            )}
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={actions.onFlip}>
            {t(off ? "externalServices:actions.turnOn" : "externalServices:actions.turnOff")}
          </Button>
        )}
        {generic && shown.length > 0 ? (
          <Button
            variant="primary"
            disabled={busy || (!dirty && off)}
            onClick={() => actions.onSave(changes)}
          >
            {t("externalServices:actions.saveAndTest")}
          </Button>
        ) : null}
        <span className="t-caption">{sourceLine(t, service)}</span>
      </div>
      {extras}
    </div>
  );
}

function ExpertFact({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="t-caption">
      <strong style={{ color: "var(--ts-text)" }}>{title}</strong>
      <br />
      {children}
    </div>
  );
}
