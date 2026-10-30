import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import ConsentCheckDialog from "./ConsentCheckDialog";
import { serviceCopy, serviceName } from "./serviceText";

/** "OpenAI freigeben?" — what leaves the server, where to, who decides. */
export default function AdminConsentDialog({
  serviceId,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  serviceId: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  const name = serviceName(t, serviceId);
  const rows: Array<[string, string]> = [
    [t("externalServices:consent.admin.whatKey"), t("externalServices:consent.admin.whatText")],
    [t("externalServices:consent.admin.whereKey"), serviceCopy(t, serviceId, "where", name)],
    [t("externalServices:consent.admin.whenKey"), t("externalServices:consent.admin.whenText")],
    [t("externalServices:consent.admin.whoKey"), t("externalServices:consent.admin.whoText")],
    [t("externalServices:consent.admin.costKey"), serviceCopy(t, serviceId, "costShort", "–")],
  ];
  return (
    <ConsentCheckDialog
      title={t("externalServices:consent.admin.title", { name })}
      checkboxLabel={t("externalServices:consent.admin.checkbox", { name })}
      confirmLabel={t("externalServices:consent.admin.confirm")}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>{t("externalServices:consent.admin.intro")}</p>
      <dl
        className="grid"
        style={{
          gridTemplateColumns: "max-content 1fr",
          gap: "var(--ts-space-sm) var(--ts-space-lg)",
        }}
      >
        {rows.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="t-caption">{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </ConsentCheckDialog>
  );
}
