import type { JSX, ReactNode } from "react";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import type { AccountService, ServiceRecommended } from "../../lib/api/externalServices";
import type { RowFeedback } from "./AdminServiceRow";
import { AccountStatusPill } from "./ServiceStatusPill";
import { Monogram, ServiceTitle } from "./ServiceIdentity";
import { ServiceFields, useFieldDrafts } from "./ServiceFields";
import { type AccountStatus, visibleFields } from "./serviceStatus";
import { lastTestLine, serviceCopy, serviceName } from "./serviceText";

export interface AccountRowProps {
  /** The service id (copy key). */
  id: string;
  recommended: ServiceRecommended;
  status: AccountStatus;
  detail: string;
  feedback: RowFeedback | null;
  busy: boolean;
  expert: boolean;
  /** The primary button of the row ("Verbinden", "Ändern", "Zustimmen …"). */
  actionLabel: string;
  onAction: () => void;
  onInfo: () => void;
  /** An expanded body replaces the action's immediate effect with a form. */
  expanded?: ReactNode;
  open?: boolean;
}

/** One row of the account page: connection, own key or AI consent — the same shape. */
export function AccountRow({
  id,
  recommended,
  status,
  detail,
  feedback,
  busy,
  expert,
  actionLabel,
  onAction,
  onInfo,
  expanded,
  open = false,
}: AccountRowProps): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  const name = serviceName(t, id);
  return (
    <div data-account-row={id} style={{ borderTop: "1px solid var(--ts-border)" }}>
      <div
        className="flex flex-wrap items-center"
        style={{ gap: "var(--ts-space-lg)", padding: "var(--ts-space-lg)" }}
      >
        <Monogram name={name} />
        <div className="flex min-w-0 flex-col" style={{ flex: "1 1 280px", gap: 2 }}>
          <ServiceTitle name={name} recommended={recommended} />
          <span className="t-caption">{serviceCopy(t, id, "purpose")}</span>
          <span
            className="t-caption"
            style={{
              color:
                feedback?.kind === "error"
                  ? "var(--ts-bad)"
                  : feedback?.kind === "ok"
                    ? "var(--ts-good)"
                    : undefined,
            }}
            role={feedback?.kind === "error" ? "alert" : "status"}
          >
            {feedback ? feedback.text : detail}
          </span>
          {expert ? <span className="t-caption">{serviceCopy(t, id, "order")}</span> : null}
        </div>
        <AccountStatusPill status={status} />
        <div className="flex items-center" style={{ gap: "var(--ts-space-sm)" }}>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={onAction}
            aria-expanded={expanded ? open : undefined}
          >
            {actionLabel}
          </Button>
          <IconButton label={t("externalServices:actions.info", { name })} onClick={onInfo}>
            <Icon name="info" />
          </IconButton>
        </div>
      </div>
      {open && expanded ? (
        <div style={{ padding: "0 var(--ts-space-lg) var(--ts-space-lg)" }}>{expanded}</div>
      ) : null}
    </div>
  );
}

/** The credential form behind "Verbinden" / "Eigenen eintragen" / "Ändern". */
export function AccountFieldsForm({
  service,
  kind,
  expert,
  busy,
  onSave,
  onCancel,
  onRemove,
  onDisable,
}: {
  service: AccountService;
  kind: "connection" | "key";
  expert: boolean;
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => void;
  onCancel: () => void;
  /** Clears every field of the service (connection) or the own key (key). */
  onRemove?: (clear: Record<string, unknown>) => void;
  onDisable?: () => void;
}): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  const shown = visibleFields(service.fields, expert);
  const { drafts, setDraft, changes } = useFieldDrafts(service.fields);
  const clear = Object.fromEntries(
    service.fields.filter((f) => f.kind !== "switch").map((f) => [f.key, ""])
  );
  const hasOwn = service.effectiveSource === "account";
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
      <ServiceFields
        serviceId={service.id}
        fields={shown}
        drafts={drafts}
        disabled={busy}
        onChange={setDraft}
      />
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <Button
          variant="primary"
          disabled={busy || Object.keys(changes).length === 0}
          onClick={() => onSave(changes)}
        >
          {t("externalServices:actions.saveAndTest")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t("externalServices:actions.cancel")}
        </Button>
        {onRemove && hasOwn ? (
          <Button variant="secondary" disabled={busy} onClick={() => onRemove(clear)}>
            {t(
              kind === "key"
                ? "externalServices:account.removeKey"
                : "externalServices:account.disconnect"
            )}
          </Button>
        ) : null}
        {onDisable ? (
          <Button variant="secondary" disabled={busy} onClick={onDisable}>
            {t("externalServices:account.disableForMe")}
          </Button>
        ) : null}
      </div>
      <span className="t-caption">{t("externalServices:account.secretNote")}</span>
    </div>
  );
}

/** The one-line state of a connection or key, from what the server derived. */
export function accountDetail(
  t: (key: string, options?: Record<string, unknown>) => string,
  service: AccountService,
  status: AccountStatus
): string {
  if (service.accountDisabled) return t("externalServices:account.detail.disabledByMe");
  if (status === "off") return t("externalServices:account.detail.disabledByAdmin");
  if (status === "viaInstance") return t("externalServices:account.detail.viaInstance");
  if (status === "noKey") return t("externalServices:account.detail.noKey");
  if (status === "notConnected") return t("externalServices:account.detail.notConnected");
  return lastTestLine(t, service.lastTest);
}
