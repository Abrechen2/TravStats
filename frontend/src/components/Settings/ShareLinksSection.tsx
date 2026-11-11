import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { shareLinksApi } from "../../lib/api/shareLinks";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { ShareLink, ShareLinkList } from "../../types/shareLinks";
import { shareLinkErrorKey } from "../shareLinks/shareLinkCopy";
import Button from "../ui/Button";
import { SettingRows } from "../ui/SettingRow";
import { SettingItem, StatusValue } from "../ui/settings";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { useRowCopy } from "./rowCopy";

const NS = "sharing:links.section";

/**
 * "Öffentliche Links" (forgejo#281): the caller's own
 * live links with their reach (views) and end, each revocable at once.
 *
 * Instance configuration lives in Administration; admins get a direct link.
 */
export default function ShareLinksSection({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const { t } = useTranslation(["sharing", "settingsRows"]);
  const row = useRowCopy("sharing");
  const format = useDisplayFormat();
  const addToast = useToastStore((state) => state.addToast);
  const [list, setList] = useState<ShareLinkList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await shareLinksApi.list());
      setLoadFailed(false);
    } catch (error) {
      logger.error("Loading share links failed:", error);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (link: ShareLink): Promise<void> => {
    setBusy(true);
    try {
      await shareLinksApi.revoke(link.id);
      addToast("success", t(`${NS}.revoked`));
      await load();
    } catch (error) {
      logger.error("Revoking a share link failed:", error);
      addToast("error", t(shareLinkErrorKey(error, "sharing:links.errors.revokeFailed")));
    } finally {
      setBusy(false);
    }
  };

  const target = (link: ShareLink): JSX.Element | string => {
    if (link.kind === "wrapped") return t(`${NS}.kind.wrapped`, { year: link.targetId });
    // A stay and a visit have no page of their own to link to (they hang off a house and
    // a place), so they are named, not linked.
    if (link.kind === "stay" || link.kind === "visit") return t(`${NS}.kind.${link.kind}`);
    const to =
      link.kind === "flight"
        ? `/flights/${link.targetId}`
        : link.kind === "cruise"
          ? `/cruises/${link.targetId}`
          : `/trips/${link.targetId}`;
    return <Link to={to}>{t(`${NS}.kind.${link.kind}`)}</Link>;
  };

  const enabled = list?.enabled === true;
  const stateCopy = row("linkserlaubt");
  const listCopy = row("linkliste");
  const offCopy = row("linksoff");

  return (
    <SectionCard>
      <SectionTitle title={t("settingsRows:sharing.sections.shareLinks")} />
      <SettingRows>
        {list && !isAdmin && (
          <SettingItem
            title={stateCopy.title}
            scope="allAccounts"
            control={
              <StatusValue>{enabled ? t(`${NS}.stateOn`) : t(`${NS}.stateOff`)}</StatusValue>
            }
          />
        )}
        {list && !enabled ? (
          // The prototype says it once, as a callout, instead of an empty list.
          <SettingItem title={offCopy.title} />
        ) : (
          <SettingItem
            title={listCopy.title}
            sub={listCopy.sub}
            error={loadFailed ? t(`${NS}.loadFailed`) : undefined}
          >
            {list && list.links.length === 0 && <p className="t-caption">{t(`${NS}.empty`)}</p>}
            {list && list.links.length > 0 && (
              <ul className="flex flex-col gap-2">
                {list.links.map((link) => (
                  <li key={link.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {target(link)}
                      <span className="t-caption">
                        {" · "}
                        {t(`${NS}.endsAt`, { date: format.dateTime(link.effectiveExpiresAt) })}
                        {" · "}
                        {t(`${NS}.views`, { count: link.viewCount })}
                      </span>
                    </span>
                    <Button variant="danger" disabled={busy} onClick={() => void revoke(link)}>
                      {t(`${NS}.revoke`)}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </SettingItem>
        )}
      </SettingRows>
    </SectionCard>
  );
}
