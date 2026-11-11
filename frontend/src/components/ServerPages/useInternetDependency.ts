import { useEffect, type ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useGuardedNavigate } from "../ui/settings";
import { useInstanceStore } from "./instanceStore";

/** Where the master switch lives. */
export const INTERNET_SWITCH_PATH = "/settings/funktionen?match=internet";

export interface InternetDependency {
  reason: ReactNode;
  jump: { label: string; onJump: () => void };
}

/**
 * The reason a row cannot act while "Server darf externe Dienste abfragen" is
 * off (settings v3 S2): the switches behind it keep their value but do nothing,
 * so the row says so instead of looking alive. `undefined` while the master
 * switch is on — and while the instance settings are not loaded yet, because a
 * reason that flashes up and goes is worse than none.
 */
export function useInternetDependency(): InternetDependency | undefined {
  const { t } = useTranslation(["settings"]);
  const go = useGuardedNavigate();
  const off = useInstanceStore((s) => s.settings?.internetEnabled === false);
  const ensureLoaded = useInstanceStore((s) => s.ensureLoaded);
  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);
  if (!off) return undefined;
  return {
    reason: t("settings:blocks.dep.internet.reason"),
    jump: { label: t("settings:blocks.dep.internet.jump"), onJump: () => go(INTERNET_SWITCH_PATH) },
  };
}
