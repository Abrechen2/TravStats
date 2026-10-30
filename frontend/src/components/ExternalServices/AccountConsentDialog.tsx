import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import ConsentCheckDialog from "./ConsentCheckDialog";

/** "Deine Importe an X schicken?" — the account's own consent, revocable. */
export default function AccountConsentDialog({
  name,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  name: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  const items = ["goes", "stays", "when", "withdraw"] as const;
  return (
    <ConsentCheckDialog
      title={t("externalServices:consent.account.title", { name })}
      checkboxLabel={t("externalServices:consent.account.checkbox", { name })}
      confirmLabel={t("externalServices:consent.account.confirm")}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>{t("externalServices:consent.account.intro", { name })}</p>
      <ul className="list-disc" style={{ paddingLeft: "var(--ts-space-xl)" }}>
        {items.map((item) => (
          <li key={item}>{t(`externalServices:consent.account.${item}`, { name })}</li>
        ))}
      </ul>
    </ConsentCheckDialog>
  );
}
