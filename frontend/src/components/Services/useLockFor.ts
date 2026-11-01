import type { ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import type { LockReason } from "../ui/settings";

/** Why a row of the services page cannot be changed, if it cannot: the demo, or what the admin forbade. */
export type RowLock = { why: LockReason; reason: ReactNode } | undefined;

export function useDemoLock(): RowLock {
  const { t } = useTranslation(["settings"]);
  const demo = useIsDemoAccount();
  return demo ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined;
}
