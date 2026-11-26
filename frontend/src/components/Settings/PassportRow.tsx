import DateField from "../../components/ui/DateField";
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
 * A date written when the field is left, not on every keystroke: a field the
 * reader has emptied to retype is not a request to clear it.
 */
function DateControl({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}): JSX.Element {
  const { id, locked, describedBy } = useSettingItem();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <DateField
      inline
      id={id}
      className="input"
      style={{ minHeight: "var(--ts-size-touch-min)" }}
      value={draft}
      disabled={locked}
      aria-disabled={locked || undefined}
      aria-describedby={describedBy}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}
