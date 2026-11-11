import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { logger } from "../../lib/logger";
import { SettingRows } from "../ui/SettingRow";
import { SettingItem, SettingWriteError, SwitchControl, useSettingWrite } from "../ui/settings";
import { SectionCard, SectionTitle } from "./SettingsShared";

/**
 * Profil › Sichtbarkeit (settings v3 `findable`): whether people on connected
 * servers may send this account a friend request. It is the same switch the
 * connections card used to carry (`PUT /sharing/remote/findable`), on the page it
 * belongs to. While the admin has not allowed other servers (or trip sharing
 * across servers is not offered) it cannot act, and the row says so instead of
 * looking alive.
 */
export default function VisibilitySection(): JSX.Element {
  const { t } = useTranslation(["settings", "sharing"]);
  const demo = useIsDemoAccount();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [findable, setFindable] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const status = await sharingRemoteApi.status();
        if (!alive) return;
        setAvailable(status.available);
        if (status.available) setFindable(await sharingRemoteApi.getFindable());
      } catch (error) {
        logger.error("Loading the findable switch failed:", error);
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const write = useSettingWrite<boolean>("profile:findable", findable, async (next) => {
    try {
      setFindable(await sharingRemoteApi.setFindable(next));
    } catch {
      throw new SettingWriteError("rejected");
    }
  });

  return (
    <SectionCard>
      <SectionTitle title={t("settings:visibility.title")} />
      <SettingRows>
        <SettingItem
          title={t("settings:visibility.findable.label")}
          sub={t("settings:visibility.findable.sub")}
          save={write}
          // Unknown (not read yet, or the read failed) is not "off by the admin":
          // no notice, but nothing to switch either.
          dependency={
            available === false
              ? { reason: t("settings:blocks.dep.noFederation.reason") }
              : undefined
          }
          locked={demo ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined}
          error={failed ? t("settings:visibility.loadFailed") : undefined}
          control={
            <SwitchControl
              checked={write.value}
              onChange={write.choose}
              label={t("settings:visibility.findable.label")}
            />
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
