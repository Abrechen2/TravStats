import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { personalApi } from "../../lib/api/companionData";
import { logger } from "../../lib/logger";
import { SettingItem, useSettingWrite } from "../ui/settings";
import { useSettingItem } from "../ui/settings/itemContext";

/**
 * "Reisepass gültig bis" (settings v3: under Profil & Anmeldung, where the
 * prototype puts it). An immediate row: the date is written when the field is
 * left, and the Companion app reads it to warn six months ahead.
 */
export default function PassportRow(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const [expiry, setExpiry] = useState<string | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    personalApi
      .get()
      .then((f) => alive && setExpiry(f.passportExpiry ?? null))
      .catch((error: unknown) => {
        logger.warn("Failed to load personal facts", error);
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const write = useSettingWrite<string>("account.passportExpiry", expiry ?? "", async (v) => {
    const facts = await personalApi.put({ passportExpiry: v === "" ? null : v });
    setExpiry(facts.passportExpiry ?? null);
  });

  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : loadFailed
      ? { why: "dependency" as const, reason: t("settings:home.loadFailed") }
      : expiry === undefined
        ? { why: "dependency" as const, reason: t("settings:home.loading") }
        : undefined;

  return (
    <SettingItem
      title={t("settings:home.passport.name")}
      sub={t("settings:home.passport.sub")}
      save={write}
      locked={locked}
      control={<DateControl value={write.value} onCommit={write.choose} />}
    />
  );
}

/**
 * A date written when the field is left, not on every keystroke: a half-typed
 * date reads as "" too, and that is not a request to clear it.
 */
function DateControl({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}): JSX.Element {
  const { id, locked, describedBy } = useSettingItem();
  return (
    <input
      id={id}
      type="date"
      className="input"
      style={{ minHeight: "var(--ts-size-touch-min)" }}
      // Keyed by the shown value: a discarded or refused pick snaps back.
      key={value}
      defaultValue={value}
      disabled={locked}
      aria-disabled={locked || undefined}
      aria-describedby={describedBy}
      onBlur={(e) => {
        if (e.target.value === "" && e.target.validity.badInput) return;
        if (e.target.value !== value) onCommit(e.target.value);
      }}
    />
  );
}
