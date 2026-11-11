import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { logger } from "../../lib/logger";
import { SettingRows } from "../ui/SettingRow";
import {
  ErrorLine,
  SettingItem,
  SettingWriteError,
  SwitchControl,
  useSettingWrite,
} from "../ui/settings";
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
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const status = await sharingRemoteApi.status();
        if (!alive) return;
        setAvailable(status.available);
        if (status.available) setFindable(await sharingRemoteApi.getFindable());
        if (alive) setLoaded(true);
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

  // Nothing to switch before the server has answered, and nothing that would write over a
  // state that could not be read: a switch drawn from a guess is a switch that lies.
  return (
    <SectionCard>
      <SectionTitle title={t("settings:visibility.title")} />
      <SettingRows>
        {failed ? (
          <ErrorLine>{t("settings:visibility.loadFailed")}</ErrorLine>
        ) : !loaded ? (
          <div style={{ minHeight: 48 }} aria-busy="true" />
        ) : (
          <SettingItem
            title={t("settings:visibility.findable.label")}
            sub={t("settings:visibility.findable.sub")}
            save={write}
            dependency={
              available === false
                ? { reason: t("settings:blocks.dep.noFederation.reason") }
                : undefined
            }
            locked={demo ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined}
            control={
              <SwitchControl
                checked={write.value}
                onChange={write.choose}
                label={t("settings:visibility.findable.label")}
              />
            }
          />
        )}
      </SettingRows>
    </SectionCard>
  );
}
