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
import { SectionCard, SectionTitle } from "./SettingsShared";

const NS = "sharing:links.section";

/**
 * "Öffentliche Links" (forgejo#281): the caller's own
 * live links with their reach (views) and end, each revocable at once.
 *
 * Instance configuration lives in Administration; admins get a direct link.
 */
export default function ShareLinksSection({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const { t } = useTranslation(["sharing"]);
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
    const to = link.kind === "flight" ? `/flights/${link.targetId}` : `/trips/${link.targetId}`;
    return <Link to={to}>{t(`${NS}.kind.${link.kind}`)}</Link>;
  };

  const enabled = list?.enabled === true;

  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />
      <SettingRows>
        {list && (
          <p className="t-caption">
            {enabled ? t(`${NS}.stateOn`) : t(`${NS}.stateOff`)} ·{" "}
            {isAdmin ? (
              <Link to="/admin?section=instance">{t(`${NS}.adminLink`)}</Link>
            ) : (
              t(`${NS}.adminOnly`)
            )}
          </p>
        )}
        {loadFailed && (
          <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
            {t(`${NS}.loadFailed`)}
          </p>
        )}
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
      </SettingRows>
    </SectionCard>
  );
}
