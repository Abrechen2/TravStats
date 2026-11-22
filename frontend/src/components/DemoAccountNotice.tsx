import { useEffect, type JSX } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useDemoAccountStore } from "../store/demoAccountStore";
import { useTranslation } from "../hooks/useTranslation";
import { useCoarsePointer } from "../hooks/useCoarsePointer";

/** Where the demo account is removed: Settings › Wartung › System. */
export const DEMO_ACCOUNT_TARGET = "/settings/wartung#system";

/**
 * "Achtung: Demo-Konto aktiv" — admins only (the old Admin warning, brought back
 * on 2026-11-22). A small amber chip, never a banner, so it pushes no content:
 * `chip` sits in the header beside the account menu, `menu` under the settings
 * menu. Both link to the row that deletes the account.
 */
export function DemoAccountNotice({ variant }: { variant: "chip" | "menu" }): JSX.Element | null {
  const { t } = useTranslation(["common"]);
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin ?? false;
  const active = useDemoAccountStore((s) => s.active);
  const refresh = useDemoAccountStore((s) => s.refresh);
  const coarse = useCoarsePointer();

  useEffect(() => {
    if (variant === "chip" && isAdmin) void refresh();
  }, [variant, isAdmin, refresh]);

  if (!isAdmin || !active) return null;

  const label = t("common:demoAccount.label");
  return (
    <Link
      to={DEMO_ACCOUNT_TARGET}
      data-testid={`demo-account-${variant}`}
      aria-label={`${label}. ${t("common:demoAccount.hint")}`}
      className="inline-flex shrink-0 items-center rounded-full whitespace-nowrap"
      style={{
        minHeight: coarse ? 40 : 24,
        padding: "0 var(--ts-space-sm)",
        fontSize: 12,
        color: "var(--ts-warn)",
        border: "1px solid var(--ts-warn)",
        background: "transparent",
      }}
    >
      {variant === "chip" ? t("common:demoAccount.short") : label}
    </Link>
  );
}
