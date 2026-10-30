import type { JSX } from "react";
import Pill from "../ui/Pill";
import { token } from "../ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import type { AccountStatus, AdminStatus } from "./serviceStatus";

const ADMIN_COLOR: Record<AdminStatus, string> = {
  active: "status-flown",
  off: "status-historical",
  missing: "status-review",
  error: "status-cancelled",
};

const ACCOUNT_COLOR: Record<AccountStatus, string> = {
  connected: "status-flown",
  ownKey: "status-flown",
  consented: "status-flown",
  viaInstance: "info",
  off: "status-historical",
  notConsented: "status-historical",
  notConnected: "status-review",
  noKey: "status-historical",
};

/** One pill per row; the word is the status, the colour only repeats it. */
export function AdminStatusPill({
  status,
  credential,
}: {
  status: AdminStatus;
  credential?: string;
}): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  // A service that needs only an address (Ollama) is not missing a "key".
  const key = status === "missing" && credential === "url" ? "missingUrl" : status;
  return <Pill color={token(ADMIN_COLOR[status])}>{t(`externalServices:status.${key}`)}</Pill>;
}

export function AccountStatusPill({ status }: { status: AccountStatus }): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  return (
    <Pill color={token(ACCOUNT_COLOR[status])}>
      {t(`externalServices:accountStatus.${status}`)}
    </Pill>
  );
}
